
import { Router, Request, Response } from "express";
import multer from "multer";
import AWS from "aws-sdk";
import { randomUUID } from "crypto";
import supabase from "../supabase";
import supabaseAdmin from "../supabaseAdmin";
import requireAuth from "../middleware/auth";

const router = Router();

const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
});

const BUCKET = process.env.AWS_S3_BUCKET!;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = [
            "image/jpeg",
            "image/png",
            "image/webp",
        ];

        if (!allowed.includes(file.mimetype)) {
            cb(new Error("Only JPEG, PNG and WebP are allowed"));
            return;
        }

        cb(null, true);
    },
});

const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
};

// GET product images
router.get("/:productId", async (req: Request, res: Response) => {
    const productId = req.params.productId;

    if (typeof productId !== "string") {
        res.status(400).json({ message: "Invalid product ID" });
        return;
    }

    const { data, error } = await supabase
        .from("product_images")
        .select("*, products!inner(id)")
        .eq("product_id", productId)
        .eq("products.active", true)
        .order("sort_order", { ascending: true });

    if (error) {
        res.status(500).json({ message: error.message });
        return;
    }

    res.json(data);
});

// UPLOAD image
router.post(
    "/:productId",
    requireAuth,
    upload.single("image"),
    async (req: Request, res: Response) => {
        const productId = req.params.productId;

        if (typeof productId !== "string" || !req.file) {
            res.status(400).json({ message: "Invalid product ID or image" });
            return;
        }

        const { data: product, error: productError } = await supabaseAdmin
            .from("products")
            .select("id")
            .eq("id", productId)
            .maybeSingle();

        if (productError) {
            res.status(500).json({ message: productError.message });
            return;
        }

        if (!product) {
            res.status(404).json({ message: "Product not found" });
            return;
        }

        const extension = extensions[req.file.mimetype];
        const imageKey =
            `uploads/products/${productId}/${randomUUID()}.${extension}`;

        try {
            await s3.upload({
                Bucket: BUCKET,
                Key: imageKey,
                Body: req.file.buffer,
                ContentType: req.file.mimetype,
            }).promise();

            const { data, error } = await supabaseAdmin
                .from("product_images")
                .insert({
                    product_id: productId,
                    image_key: imageKey,
                    alt_text: req.body.alt_text || null,
                    sort_order: 0,
                })
                .select()
                .single();

            if (error) {
                // Remove orphaned S3 object if DB insert fails.
                await s3.deleteObject({
                    Bucket: BUCKET,
                    Key: imageKey,
                }).promise().catch(console.error);

                res.status(400).json({ message: error.message });
                return;
            }

            res.status(201).json(data);
        } catch (error) {
            console.error("Product image upload failed:", error);
            res.status(500).json({ message: "Image upload failed" });
        }
    }
);

// UPDATE image metadata
router.put("/:imageId", requireAuth, async (req: Request, res: Response) => {
    const imageId = req.params.imageId;
    const { alt_text, sort_order } = req.body;

    if (
        typeof imageId !== "string" ||
        (alt_text !== undefined &&
            alt_text !== null &&
            typeof alt_text !== "string") ||
        (sort_order !== undefined &&
            (!Number.isSafeInteger(sort_order) || sort_order < 0)) ||
        (alt_text === undefined && sort_order === undefined)
    ) {
        res.status(400).json({ message: "Invalid image data" });
        return;
    }

    const { data, error } = await supabaseAdmin
        .from("product_images")
        .update({
            ...(alt_text !== undefined ? { alt_text } : {}),
            ...(sort_order !== undefined ? { sort_order } : {}),
        })
        .eq("id", imageId)
        .select()
        .maybeSingle();

    if (error) {
        res.status(500).json({ message: error.message });
        return;
    }

    if (!data) {
        res.status(404).json({ message: "Image not found" });
        return;
    }

    res.json(data);
});

// DELETE image
router.delete("/:imageId", requireAuth, async (req: Request, res: Response) => {
    const imageId = req.params.imageId;

    if (typeof imageId !== "string") {
        res.status(400).json({ message: "Invalid image ID" });
        return;
    }

    const { data: image, error: findError } = await supabaseAdmin
        .from("product_images")
        .select("*")
        .eq("id", imageId)
        .maybeSingle();

    if (findError) {
        res.status(500).json({ message: findError.message });
        return;
    }

    if (!image) {
        res.status(404).json({ message: "Image not found" });
        return;
    }

    // Delete DB reference first. S3 cleanup can be retried if needed.
    const { error: deleteError } = await supabaseAdmin
        .from("product_images")
        .delete()
        .eq("id", imageId);

    if (deleteError) {
        res.status(500).json({ message: deleteError.message });
        return;
    }

    try {
        await s3.deleteObject({
            Bucket: BUCKET,
            Key: image.image_key,
        }).promise();
    } catch (error) {
        console.error("S3 image cleanup failed:", image.image_key, error);
    }

    res.status(204).send();
});

export default router;
