import { BarChart3, Boxes, ClipboardList, Factory, Globe2, Layers, ShieldCheck, Smartphone, Truck, Wallet, type LucideIcon } from 'lucide-react';

export const FEATURE_ICON_MAP: Record<string, LucideIcon> = {
    boxes: Boxes,
    layers: Layers,
    clipboard: ClipboardList,
    wallet: Wallet,
    smartphone: Smartphone,
    globe: Globe2,
    factory: Factory,
    truck: Truck,
    shield: ShieldCheck,
    chart: BarChart3,
};

export const FEATURE_ICON_NAMES = Object.keys(FEATURE_ICON_MAP);
