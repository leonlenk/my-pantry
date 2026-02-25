// Type shims for packages whose types the TS language server can't resolve at edit-time.
// The actual types are provided at build time by Astro/Vite.
declare module "@lucide/astro" {
    import type { AstroComponentFactory } from "astro/runtime/server/index.js";
    // Each icon is an Astro component accepting common SVG props
    export const Search: AstroComponentFactory;
    export const X: AstroComponentFactory;
    export const Utensils: AstroComponentFactory;
    // Allow any other icon to be imported without TS complaining
    const _default: Record<string, AstroComponentFactory>;
    export default _default;
}

declare module "feather-icons" {
    interface IconOptions {
        width?: number | string;
        height?: number | string;
        fill?: string;
        stroke?: string;
        "stroke-width"?: number | string;
        [key: string]: unknown;
    }

    interface Icon {
        toSvg(opts?: IconOptions): string;
        contents: string;
        tags: string[];
        attrs: Record<string, string>;
        name: string;
    }

    interface FeatherIcons {
        icons: Record<string, Icon | undefined>;
        replace(opts?: IconOptions): void;
        toSvg(name: string, opts?: IconOptions): string;
    }

    const feather: FeatherIcons;
    export default feather;
}
