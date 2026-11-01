// SPDX-License-Identifier: GPL-2.0
/*
 * nitro_battery: limite de carga da bateria do Acer ("health mode" do NitroSense/Care Center) via WMI.
 *
 * GUID 79772EC5, o mesmo protocolo do acer-wmi-battery (github.com/frederik-h/acer-wmi-battery):
 *   método 20 (ler):   in {bateria=1, consulta=1, 0, 0}         out {funções, ret[2], estado[5]}
 *   método 21 (mudar): in {bateria=1, função=1, ligado, 0×5}    out {ret, 0}
 * O firmware só tem liga/desliga: ligado segura a carga em 80%. Exposto do jeito padrão do kernel, como
 * charge_control_end_threshold da bateria (80 ou 100), que o UPower e o GNOME também enxergam.
 * Escrever qualquer valor abaixo de 100 liga o limite (fica 80); 100 desliga.
 */
#include <linux/module.h>
#include <linux/acpi.h>
#include <linux/mutex.h>
#include <linux/power_supply.h>
#include <linux/slab.h>
#include <linux/wmi.h>
#include <acpi/battery.h>

#define BATTERY_GUID	"79772EC5-04B1-4BFD-843C-61E7F77B6CC9"
#define METHOD_GET	20
#define METHOD_SET	21
#define BATTERY_INDEX	1	/* o software da Acer sempre usa 1 */
#define HEALTH_MODE	BIT(0)
#define LIMIT		80

struct nb_get_in {
	u8 battery;
	u8 query;
	u8 reserved[2];
} __packed;

struct nb_get_out {
	u8 functions;
	u8 ret[2];
	u8 status[5];
} __packed;

struct nb_set_in {
	u8 battery;
	u8 function;
	u8 on;
	u8 reserved[5];
} __packed;

struct nb_priv {
	struct wmi_device *wdev;
	struct acpi_battery_hook hook;
	struct mutex lock;
};

static int nb_get(struct nb_priv *p, bool *on, u8 *functions)
{
	struct nb_get_in in = { .battery = BATTERY_INDEX, .query = 1 };
	struct acpi_buffer inbuf = { sizeof(in), &in };
	struct acpi_buffer outbuf = { ACPI_ALLOCATE_BUFFER, NULL };
	union acpi_object *obj;
	struct nb_get_out out;
	int ret = -EIO;

	if (ACPI_FAILURE(wmidev_evaluate_method(p->wdev, 0, METHOD_GET, &inbuf, &outbuf)))
		return -EIO;
	obj = outbuf.pointer;
	if (obj && obj->type == ACPI_TYPE_BUFFER && obj->buffer.length == sizeof(out)) {
		memcpy(&out, obj->buffer.pointer, sizeof(out));
		*functions = out.functions;
		*on = out.status[0] > 0;
		ret = 0;
	}
	kfree(obj);
	return ret;
}

static int nb_set(struct nb_priv *p, bool on)
{
	struct nb_set_in in = { .battery = BATTERY_INDEX, .function = HEALTH_MODE, .on = on };
	struct acpi_buffer inbuf = { sizeof(in), &in };
	struct acpi_buffer outbuf = { ACPI_ALLOCATE_BUFFER, NULL };
	union acpi_object *obj;
	int ret = -EIO;

	if (ACPI_FAILURE(wmidev_evaluate_method(p->wdev, 0, METHOD_SET, &inbuf, &outbuf)))
		return -EIO;
	obj = outbuf.pointer;
	/* resposta {ret, 0}; o firmware devolve 4 bytes, só o primeiro importa */
	if (obj && obj->type == ACPI_TYPE_BUFFER && obj->buffer.length >= 1)
		ret = obj->buffer.pointer[0] ? -EIO : 0;
	kfree(obj);
	return ret;
}

static const enum power_supply_property nb_props[] = {
	POWER_SUPPLY_PROP_CHARGE_CONTROL_END_THRESHOLD,
};

static int nb_get_property(struct power_supply *psy, const struct power_supply_ext *ext, void *data,
			   enum power_supply_property psp, union power_supply_propval *val)
{
	struct nb_priv *p = data;
	u8 functions;
	bool on;
	int ret;

	if (psp != POWER_SUPPLY_PROP_CHARGE_CONTROL_END_THRESHOLD)
		return -EINVAL;
	mutex_lock(&p->lock);
	ret = nb_get(p, &on, &functions);
	mutex_unlock(&p->lock);
	if (ret)
		return ret;
	val->intval = on ? LIMIT : 100;
	return 0;
}

static int nb_set_property(struct power_supply *psy, const struct power_supply_ext *ext, void *data,
			   enum power_supply_property psp, const union power_supply_propval *val)
{
	struct nb_priv *p = data;
	int ret;

	if (psp != POWER_SUPPLY_PROP_CHARGE_CONTROL_END_THRESHOLD)
		return -EINVAL;
	if (val->intval < 1 || val->intval > 100)
		return -EINVAL;
	mutex_lock(&p->lock);
	ret = nb_set(p, val->intval < 100);
	mutex_unlock(&p->lock);
	return ret;
}

static int nb_writeable(struct power_supply *psy, const struct power_supply_ext *ext, void *data,
			enum power_supply_property psp)
{
	return psp == POWER_SUPPLY_PROP_CHARGE_CONTROL_END_THRESHOLD;
}

static const struct power_supply_ext nb_ext = {
	.name = "nitro_battery",
	.properties = nb_props,
	.num_properties = ARRAY_SIZE(nb_props),
	.get_property = nb_get_property,
	.set_property = nb_set_property,
	.property_is_writeable = nb_writeable,
};

static int nb_add_battery(struct power_supply *battery, struct acpi_battery_hook *hook)
{
	struct nb_priv *p = container_of(hook, struct nb_priv, hook);

	return power_supply_register_extension(battery, &nb_ext, &p->wdev->dev, p);
}

static int nb_remove_battery(struct power_supply *battery, struct acpi_battery_hook *hook)
{
	power_supply_unregister_extension(battery, &nb_ext);
	return 0;
}

static int nb_probe(struct wmi_device *wdev, const void *context)
{
	struct nb_priv *p;
	u8 functions;
	bool on;
	int ret;

	p = devm_kzalloc(&wdev->dev, sizeof(*p), GFP_KERNEL);
	if (!p)
		return -ENOMEM;
	p->wdev = wdev;
	ret = devm_mutex_init(&wdev->dev, &p->lock);
	if (ret)
		return ret;

	ret = nb_get(p, &on, &functions);
	if (ret)
		return ret;
	if (!(functions & HEALTH_MODE)) {
		dev_info(&wdev->dev, "firmware sem limite de carga\n");
		return -ENODEV;
	}
	dev_info(&wdev->dev, "limite de carga em 80%%: %s\n", on ? "ligado" : "desligado");

	p->hook.name = "nitro_battery";
	p->hook.add_battery = nb_add_battery;
	p->hook.remove_battery = nb_remove_battery;
	return devm_battery_hook_register(&wdev->dev, &p->hook);
}

static const struct wmi_device_id nb_ids[] = {
	{ BATTERY_GUID, NULL },
	{ }
};
MODULE_DEVICE_TABLE(wmi, nb_ids);

static struct wmi_driver nb_driver = {
	.driver = {
		.name = "nitro_battery",
	},
	.id_table = nb_ids,
	.probe = nb_probe,
};
module_wmi_driver(nb_driver);

MODULE_DESCRIPTION("Limite de carga da bateria do Acer (health mode) via WMI");
MODULE_LICENSE("GPL");
