import { Router, Request, Response } from 'express';
import multer from 'multer';
import AWS from 'aws-sdk';
import supabase from '../supabase';

const router = Router();

type MulterRequest = Request & { file?: Express.Multer.File };

interface S3UploadResult {
    Location: string;
    Key: string;
}

const storage = multer.memoryStorage();
const upload = multer({ storage });

// AWS S3 setup
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
});

const uploadToS3 = (params: AWS.S3.PutObjectRequest): Promise<S3UploadResult> =>
    new Promise((resolve, reject) => {
        s3.upload(params, (err: Error, data: S3UploadResult) => {
            if (err) return reject(err);
            resolve(data);
        });
    });

// GET all images
router.get("/", async (_req: Request, res: Response) => {
    try {
        const { data, error } = await supabase
            .from("images")
            .select("*")
            .order("id", { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        res.status(500).json({ message });
    }
});

// POST / upload image
router.post("/", upload.single("image"), async (req: MulterRequest, res: Response) => {
    try {
        if (!req.file) {
            res.status(400).json({ message: "No file uploaded" });
            return;
        }

        const s3params: AWS.S3.PutObjectRequest = {
            Bucket: process.env.AWS_S3_BUCKET!,
            Key: `uploads/${req.file.originalname}`,
            Body: req.file.buffer,
            ContentType: req.file.mimetype,
        };

        const s3Data = await uploadToS3(s3params);

        const { data, error } = await supabase
            .from("images")
            .insert([{ image_url: s3Data.Location }])
            .select()
            .single();

        if (error) throw error;
        res.status(201).json({ message: "Image uploaded successfully", image: data });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        res.status(500).json({ message });
    }
});

// DELETE image
router.delete("/:id", async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from("images")
            .delete()
            .eq("id", id)
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        res.status(500).json({ message });
    }
});

export default router;