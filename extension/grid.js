// Gerenciador de layout da grade do menu (Clutter): põe cada filho na linha/coluna que o laboratório
// escolheu (child._gridItem = {id, size, r, c}). As contas são as de layout.js (geometry): ladrilhos têm
// altura de célula; a linha de um bloco de largura inteira cresce com ele (ex.: acordeão aberto).
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import {geometry} from './layout.js';

export const GridMenuLayout = GObject.registerClass(
class GridMenuLayout extends Clutter.LayoutManager {
    _init(gap) {
        super._init();
        this._gap = gap;
    }

    set gap(v) {
        this._gap = v;
        this.layout_changed();
    }

    _geometry(container, width) {
        const kids = container.get_children().filter(k => k.visible && k._gridItem);
        const byId = new Map(kids.map(k => [k._gridItem.id, k]));
        // blocos de largura inteira: a altura natural deles na largura da grade
        const natural = item => byId.get(item.id)?.get_preferred_height(width)[1] ?? 0;
        return {kids, byId, geo: geometry(kids.map(k => k._gridItem), width, this._gap, natural)};
    }

    vfunc_get_preferred_width(_container, _forHeight) {
        return [0, 0];
    }

    vfunc_get_preferred_height(container, forWidth) {
        if (forWidth < 0)
            return [0, 0];
        const {geo} = this._geometry(container, forWidth);
        return [geo.height, geo.height];
    }

    vfunc_allocate(container, box) {
        const width = box.get_width();
        const {byId, geo} = this._geometry(container, width);
        for (const b of geo.boxes) {
            const kid = byId.get(b.id);
            const child = new Clutter.ActorBox();
            child.set_origin(box.x1 + b.x, box.y1 + b.y);
            child.set_size(b.w, b.h);
            kid.allocate(child);
        }
    }
});
