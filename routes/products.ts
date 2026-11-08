
import { Router, Request, Response } from "express";
import supabase from "../supabase";
import requireAuth from "../middleware/auth";
import { Database } from "../types/supabase";
import supabaseAdmin from "../supabaseAdmin";
import { availableProduct } from "../lib/inventory";

const PRODUCT_CATEGORIES = ["leash", "collar", "other"] as const;

type ProductCategory = typeof PRODUCT_CATEGORIES[number];

const isProductCategory = (value: unknown): value is ProductCategory =>
    typeof value === "string" &&
    PRODUCT_CATEGORIES.some(category => category === value);

const router = Router();

type ProductInsert =
    Database["public"]["Tables"]["products"]["Insert"];

type ProductUpdate =
    Database["public"]["Tables"]["products"]["Update"];

const productSelect = `
    *,
    product_variants (*),
    product_images (*)
`;

const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "Unknown error";

// GET all active products (public)
router.get("/", async (_req: Request, res: Response) => {
    const { data, error } = await supabase
        .from("products")
        .select(productSelect)
        .eq("active", true)
        .order("created_at", { ascending: false });

    if (error) {
        res.status(500).json({ message: error.message });
        return;
    }

    res.json(data?.map(availableProduct));
});

// GET all products, including inactive (admin)
router.get("/admin", requireAuth, async (_req: Request, res: Response) => {
    const { data, error } = await supabaseAdmin
        .from("products")
        .select(productSelect)
        .order("created_at", { ascending: false });

    if (error) {
        res.status(500).json({ message: error.message });
        return;
    }

    res.json(data);
});

// GET product by slug (public)
router.get("/:slug", async (req: Request, res: Response) => {
    const { slug } = req.params;

    const { data, error } = await supabase
        .from("products")
        .select(productSelect)
        .eq("slug", slug)
        .eq("active", true)
        .maybeSingle();

    if (error) {
        res.status(500).json({ message: error.message });
        return;
    }

    if (!data) {
        res.status(404).json({ message: "Product not found" });
        return;
    }

    res.json(availableProduct(data));
});

// CREATE product (admin)
router.post("/", requireAuth, async (req: Request, res: Response) => {
    try {
        const { name, slug, category, description, base_price, active } =
            req.body;

        if (
            typeof name !== "string" ||
            !name.trim() ||
            typeof slug !== "string" ||
            !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
            !isProductCategory(category) ||
            !Number.isSafeInteger(base_price) ||
            base_price < 0 ||
            (description !== undefined &&
                description !== null &&
                typeof description !== "string") ||
            (active !== undefined && typeof active !== "boolean")
        ) {
            res.status(400).json({ message: "Invalid product data" });
            return;
        }

        const product: ProductInsert = {
            name: name.trim(),
            slug,
            category: category.trim(),
            description: description ?? null,
            base_price,
            active: active ?? false,
        };

        const { data, error } = await supabaseAdmin
            .from("products")
            .insert(product)
            .select()
            .single();

        if (error) {
            res.status(error.code === "23505" ? 409 : 400)
                .json({ message: error.message });
            return;
        }

        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ message: getErrorMessage(error) });
    }
});

// UPDATE product (admin)
router.put("/:id", requireAuth, async (req: Request, res: Response) => {
    try {
        const id = req.params.id;

if (typeof id !== "string") {
    res.status(400).json({ message: "Invalid product ID" });
    return;
}
        const allowedFields = [
            "name", "slug", "category",
            "description", "base_price", "active",
        ] as const;

        const update: ProductUpdate = {};

        for (const field of allowedFields) {
            if (Object.prototype.hasOwnProperty.call(req.body, field)) {
                (update as Record<string, unknown>)[field] = req.body[field];
            }
        }

        if (
            Object.keys(update).length === 0 ||
            (update.name !== undefined &&
                (typeof update.name !== "string" || !update.name.trim())) ||
            (update.slug !== undefined &&
                (typeof update.slug !== "string" ||
                    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(update.slug))) ||
            (update.category !== undefined &&
                (typeof update.category !== "string" ||
                    !update.category.trim())) ||
            (update.description !== undefined &&
                update.description !== null &&
                typeof update.description !== "string") ||
            (update.base_price !== undefined &&
                (!Number.isSafeInteger(update.base_price) ||
                    update.base_price < 0)) ||
            (update.active !== undefined &&
                typeof update.active !== "boolean")
        ) {
            res.status(400).json({ message: "Invalid product data" });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from("products")
            .update(update)
            .eq("id", id)
            .select()
            .maybeSingle();

        if (error) {
            res.status(error.code === "23505" ? 409 : 400)
                .json({ message: error.message });
            return;
        }

        if (!data) {
            res.status(404).json({ message: "Product not found" });
            return;
        }

        res.json(data);
    } catch (error) {
        res.status(500).json({ message: getErrorMessage(error) });
    }
});

// DEACTIVATE product (admin)
router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
    const id = req.params.id;

if (typeof id !== "string") {
    res.status(400).json({ message: "Invalid product ID" });
    return;
}

    const { data, error } = await supabaseAdmin
        .from("products")
        .update({ active: false })
        .eq("id", id)
        .select()
        .maybeSingle();

    if (error) {
        res.status(500).json({ message: error.message });
        return;
    }

    if (!data) {
        res.status(404).json({ message: "Product not found" });
        return;
    }

    res.json(data);
});

export default router;
