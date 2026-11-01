// SPDX-License-Identifier: GPL-2.0
/*
 * nitro_fan: ventoinhas do Acer Nitro via WMI gaming (GUID 7A4DDFE7), os mesmos métodos do NitroSense.
 *
 * Reproduz o fan control do acer-wmi oficial (que só expõe pwm no hwmon a partir do kernel com o quirk do ANV15-51):
 *   método 0x0E (modo):       u64 = bitmap | (modo_cpu << 16, se bit 0) | (modo_gpu << 22, se bit 3)
 *   método 0x10 (velocidade): u64 = id_ventoinha | (porcentagem << 8); id 1 = CPU, 4 = GPU
 *   método 0x11 (leitura):    u32 = id_ventoinha; resposta (porcentagem << 8), byte 0 = status
 * Arquivos em /sys/kernel/nitro_fan (só root escreve):
 *   mode       auto | max | custom
 *   cpu_speed  0–100 (%), vale no modo custom
 *   gpu_speed  0–100 (%), vale no modo custom
 * Só carrega nos modelos testados (tabela DMI); force=1 pula essa checagem.
 */
#include <linux/module.h>
#include <linux/kobject.h>
#include <linux/sysfs.h>
#include <linux/string.h>
#include <linux/acpi.h>
#include <linux/dmi.h>
#include <linux/mutex.h>
#include <linux/slab.h>

#define GAMING_GUID	"7A4DDFE7-5B5D-40B4-8595-4408E0CC7F56"
#define METHOD_FAN	0x0E
#define METHOD_SPEED	0x10
#define METHOD_GSPEED	0x11
#define FAN_CPU		BIT(0)
#define FAN_GPU		BIT(3)
#define ID_CPU		0x01
#define ID_GPU		0x04

#define MODE_AUTO	1
#define MODE_TURBO	2
#define MODE_CUSTOM	3

static bool force;
module_param(force, bool, 0444);
MODULE_PARM_DESC(force, "Carrega mesmo fora dos modelos testados (por sua conta e risco)");

static const struct dmi_system_id nf_models[] = {
	{
		.ident = "Acer Nitro ANV15-51",
		.matches = {
			DMI_MATCH(DMI_SYS_VENDOR, "Acer"),
			DMI_MATCH(DMI_PRODUCT_NAME, "Nitro ANV15-51"),
		},
	},
	{ }
};

static struct kobject *nf_kobj;
static DEFINE_MUTEX(nf_lock);
static int nf_mode;	/* 0 = desconhecido (ainda não escrito) */

static int nf_call(u32 method, u64 in, size_t in_size, u64 *out)
{
	struct acpi_buffer inbuf = { in_size, &in };
	struct acpi_buffer outbuf = { ACPI_ALLOCATE_BUFFER, NULL };
	union acpi_object *obj;
	acpi_status st;
	int ret = -EIO;

	st = wmi_evaluate_method(GAMING_GUID, 0, method, &inbuf, &outbuf);
	if (ACPI_FAILURE(st))
		return -EIO;
	obj = outbuf.pointer;
	if (obj && obj->type == ACPI_TYPE_INTEGER) {
		*out = obj->integer.value;
		ret = 0;
	}
	kfree(outbuf.pointer);
	return ret;
}

static int nf_set_mode(u64 mode)
{
	u64 ret;
	int err = nf_call(METHOD_FAN, (FAN_CPU | FAN_GPU) | (mode << 16) | (mode << 22), sizeof(u64), &ret);

	if (err)
		return err;
	/* o driver da Acer trata byte 0 != 0 como erro */
	return (ret & 0xff) ? -EIO : 0;
}

static int nf_set_speed(u8 fan, u8 pct)
{
	u64 ret;
	int err = nf_call(METHOD_SPEED, fan | ((u64)pct << 8), sizeof(u64), &ret);

	if (err)
		return err;
	switch (ret & 0xff) {
	case 0x00:
		return 0;
	case 0x01:
		return -ENODEV;
	case 0x02:
		return -EINVAL;
	default:
		return -ENXIO;
	}
}

static int nf_get_speed(u8 fan, u8 *pct)
{
	u64 ret;
	int err = nf_call(METHOD_GSPEED, fan, sizeof(u32), &ret);

	if (err)
		return err;
	if (ret & 0xff)
		return -ENODEV;
	*pct = (ret >> 8) & 0xff;
	return 0;
}

static ssize_t mode_show(struct kobject *k, struct kobj_attribute *a, char *buf)
{
	static const char * const names[] = { "unknown", "auto", "max", "custom" };

	return sysfs_emit(buf, "%s\n", names[nf_mode]);
}

static ssize_t mode_store(struct kobject *k, struct kobj_attribute *a, const char *buf, size_t n)
{
	int mode, ret;

	if (sysfs_streq(buf, "auto"))
		mode = MODE_AUTO;
	else if (sysfs_streq(buf, "max"))
		mode = MODE_TURBO;
	else if (sysfs_streq(buf, "custom"))
		mode = MODE_CUSTOM;
	else
		return -EINVAL;

	mutex_lock(&nf_lock);
	ret = nf_set_mode(mode);
	if (!ret)
		nf_mode = mode;
	mutex_unlock(&nf_lock);
	return ret ? ret : n;
}

static u8 attr_fan(struct kobj_attribute *a)
{
	return strcmp(a->attr.name, "gpu_speed") ? ID_CPU : ID_GPU;
}

static ssize_t speed_show(struct kobject *k, struct kobj_attribute *a, char *buf)
{
	u8 pct;
	int ret;

	mutex_lock(&nf_lock);
	ret = nf_get_speed(attr_fan(a), &pct);
	mutex_unlock(&nf_lock);
	return ret ? ret : sysfs_emit(buf, "%u\n", pct);
}

static ssize_t speed_store(struct kobject *k, struct kobj_attribute *a, const char *buf, size_t n)
{
	u8 pct;
	int ret = kstrtou8(buf, 10, &pct);

	if (ret)
		return ret;
	if (pct > 100)
		return -EINVAL;
	mutex_lock(&nf_lock);
	ret = nf_set_speed(attr_fan(a), pct);
	mutex_unlock(&nf_lock);
	return ret ? ret : n;
}

static struct kobj_attribute mode_attr = __ATTR(mode, 0644, mode_show, mode_store);
static struct kobj_attribute cpu_attr = __ATTR(cpu_speed, 0644, speed_show, speed_store);
static struct kobj_attribute gpu_attr = __ATTR(gpu_speed, 0644, speed_show, speed_store);

static struct attribute *nf_attrs[] = {
	&mode_attr.attr,
	&cpu_attr.attr,
	&gpu_attr.attr,
	NULL,
};

static const struct attribute_group nf_group = {
	.attrs = nf_attrs,
};

static int __init nf_init(void)
{
	int ret;

	if (!dmi_check_system(nf_models)) {
		if (!force) {
			pr_info("nitro_fan: modelo não testado, nada feito (use force=1 para carregar mesmo assim)\n");
			return -ENODEV;
		}
		pr_warn("nitro_fan: modelo não testado, carregando por force=1\n");
	}
	if (!wmi_has_guid(GAMING_GUID))
		return -ENODEV;
	nf_kobj = kobject_create_and_add("nitro_fan", kernel_kobj);
	if (!nf_kobj)
		return -ENOMEM;
	ret = sysfs_create_group(nf_kobj, &nf_group);
	if (ret)
		kobject_put(nf_kobj);
	return ret;
}

static void __exit nf_exit(void)
{
	/* devolve o controle à BIOS ao descarregar */
	if (nf_mode)
		nf_set_mode(MODE_AUTO);
	sysfs_remove_group(nf_kobj, &nf_group);
	kobject_put(nf_kobj);
}

module_init(nf_init);
module_exit(nf_exit);
MODULE_DESCRIPTION("Ventoinhas do Acer Nitro via WMI gaming");
MODULE_LICENSE("GPL");
