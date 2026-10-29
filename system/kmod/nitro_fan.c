// SPDX-License-Identifier: GPL-2.0
/*
 * nitro_fan: modo das ventoinhas do Acer Nitro (ANV15-51) via WMI gaming (GUID 7A4DDFE7, método 0x0E).
 *
 * Reproduz WMID_gaming_set_fan_behavior() do acer-wmi (que no ANV15-51 não expõe pwm no hwmon):
 *   entrada u64 = bitmap | (modo_cpu << 16, se bit 0) | (modo_gpu << 22, se bit 3)
 * Escrita em /sys/kernel/nitro_fan/mode: "auto" | "max" | "custom". Só root.
 */
#include <linux/module.h>
#include <linux/kobject.h>
#include <linux/sysfs.h>
#include <linux/string.h>
#include <linux/acpi.h>
#include <linux/slab.h>

#define GAMING_GUID	"7A4DDFE7-5B5D-40B4-8595-4408E0CC7F56"
#define METHOD_FAN	0x0E
#define FAN_CPU		BIT(0)
#define FAN_GPU		BIT(3)

#define MODE_AUTO	1
#define MODE_TURBO	2
#define MODE_CUSTOM	3

static struct kobject *nf_kobj;
static int nf_mode;	/* 0 = desconhecido (ainda não escrito) */

static int nf_set(u64 mode)
{
	u64 in = (FAN_CPU | FAN_GPU) | (mode << 16) | (mode << 22);
	struct acpi_buffer inbuf = { sizeof(in), &in };
	struct acpi_buffer outbuf = { ACPI_ALLOCATE_BUFFER, NULL };
	union acpi_object *obj;
	u64 ret = 0;
	acpi_status st;

	st = wmi_evaluate_method(GAMING_GUID, 0, METHOD_FAN, &inbuf, &outbuf);
	if (ACPI_FAILURE(st))
		return -EIO;
	obj = outbuf.pointer;
	if (obj && obj->type == ACPI_TYPE_INTEGER)
		ret = obj->integer.value;
	kfree(outbuf.pointer);
	/* o driver da Acer trata byte 0 != 0 como erro */
	return (ret & 0xff) ? -EIO : 0;
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

	ret = nf_set(mode);
	if (ret)
		return ret;
	nf_mode = mode;
	return n;
}

static struct kobj_attribute mode_attr = __ATTR(mode, 0644, mode_show, mode_store);

static int __init nf_init(void)
{
	int ret;

	if (!wmi_has_guid(GAMING_GUID))
		return -ENODEV;
	nf_kobj = kobject_create_and_add("nitro_fan", kernel_kobj);
	if (!nf_kobj)
		return -ENOMEM;
	ret = sysfs_create_file(nf_kobj, &mode_attr.attr);
	if (ret)
		kobject_put(nf_kobj);
	return ret;
}

static void __exit nf_exit(void)
{
	/* devolve o controle à BIOS ao descarregar */
	if (nf_mode)
		nf_set(MODE_AUTO);
	kobject_put(nf_kobj);
}

module_init(nf_init);
module_exit(nf_exit);
MODULE_DESCRIPTION("Modo das ventoinhas do Acer Nitro via WMI gaming");
MODULE_LICENSE("GPL");
