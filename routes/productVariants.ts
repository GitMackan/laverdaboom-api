
import { Router, Request, Response } from "express";
import supabase from "../supabase";
import supabaseAdmin from "../supabaseAdmin";
import requireAuth from "../middleware/auth";
import { Database } from "../types/supabase";

const router = Router();

type VariantInsert =
    Database["public"]["Tables"]["product_variants"]["Insert"];

type VariantUpdate =
    Database["public"]["Tables"]["product_variants"]["Update"];

const validateVariant = (body: Record<string, unknown>) => {
    if (
        body.price !== undefined &&
        (!Number.isSafeInteger(body.price) || (body.price as number) < 0)
    ) return false;

    if (
        body.stock_quantity !== undefined &&
        (!Number.isSafeInteger(body.stock_quantity) ||
            (body.stock_quantity as number) < 0)
    ) return false;

    if (
        body.length_cm !== undefined &&
        body.length_cm !== null &&
        (typeof body.length_cm !== "number" ||
            !Number.isFinite(body.length_cm) ||
            body.length_cm <= 0)
    ) return false;

    for (const field of ["color", "size", "sku"]) {
        const value = body[field];
        if (value !== undefined && value !== null &&
            typeof value !== "string") return false;
    }

    for (const field of ["active", "made_to_order"]) {
        const value = body[field];
        if (value !== undefined && typeof value !== "boolean") return false;
    }

    return true;
};

// GET active variants for an active product
router.get("/product/:productId", async (req: Request, res: Response) => {
    const productId = req.params.productId;

    if (typeof productId !== "string") {
        res.status(400).json({ message: "Invalid product ID" });
        return;
    }

    const { data, error } = await supabase
        .from("product_variants")
        .select("*, products!inner(id)")
        .eq("product_id", productId)
        .eq("active", true)
        .eq("products.active", true);

    if (error) {
        res.status(500).json({ message: error.message });
        return;
    }

    res.json(data);
});

// CREATE variant
router.post("/", requireAuth, async (req: Request, res: Response) => {
    const {
        product_id, color, length_cm, size, sku,
        price, stock_quantity, made_to_order, active,
    } = req.body;

    if (
        typeof product_id !== "string" ||
        !product_id ||
        !Number.isSafeInteger(price) ||
        price < 0 ||
        !validateVariant(req.body)
    ) {
        res.status(400).json({ message: "Invalid variant data" });
        return;
    }

    const variant: VariantInsert = {
        product_id,
        color: color ?? null,
        length_cm: length_cm ?? null,
        size: size ?? null,
        sku: sku ?? null,
        price,
        stock_quantity: stock_quantity ?? 0,
        made_to_order: made_to_order ?? false,
        active: active ?? true,
    };

    const { data, error } = await supabaseAdmin
        .from("product_variants")
        .insert(variant)
        .select()
        .single();

    if (error) {
        res.status(400).json({ message: error.message });
        return;
    }

    res.status(201).json(data);
});

// UPDATE variant
router.put("/:id", requireAuth, async (req: Request, res: Response) => {
    const id = req.params.id;

    if (typeof id !== "string" || !validateVariant(req.body)) {
        res.status(400).json({ message: "Invalid variant data" });
        return;
    }

    const allowedFields = [
        "color", "length_cm", "size", "sku",
        "price", "stock_quantity", "made_to_order", "active",
    ] as const;

    const update: VariantUpdate = {};

    for (const field of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(req.body, field)) {
            (update as Record<string, unknown>)[field] = req.body[field];
        }
    }

    if (Object.keys(update).length === 0) {
        res.status(400).json({ message: "No fields to update" });
        return;
    }

    const { data, error } = await supabaseAdmin
        .from("product_variants")
        .update(update)
        .eq("id", id)
        .select()
        .maybeSingle();

    if (error) {
        res.status(400).json({ message: error.message });
        return;
    }

    if (!data) {
        res.status(404).json({ message: "Variant not found" });
        return;
    }

    res.json(data);
});

// DEACTIVATE variant
router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
    const id = req.params.id;

    if (typeof id !== "string") {
        res.status(400).json({ message: "Invalid variant ID" });
        return;
    }

    const { data, error } = await supabaseAdmin
        .from("product_variants")
        .update({ active: false })
        .eq("id", id)
        .select()
        .maybeSingle();

    if (error) {
        res.status(500).json({ message: error.message });
        return;
    }

    if (!data) {
        res.status(404).json({ message: "Variant not found" });
        return;
    }

    res.json(data);
});

export default router;
