import { Router, Request, Response } from "express";
import multer from "multer";
import AWS from "aws-sdk";
import supabase from "../supabase";
import requireAuth from "../middleware/auth";
import { Database } from "../types/supabase";

type MulterRequest = Request & { file?: Express.Multer.File };

const router = Router();

// Types
type DogUpdate = Database['public']['Tables']['dogs']['Update'];

interface S3UploadResult {
    Location: string;
    Key: string;
}

// Multer memory storage
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

// UPDATE dog
router.put("/:id", requireAuth, upload.single("file"), async (req: MulterRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            name, nickname, breed, size, hairType, regNr, gender,
            color, ivdd, bph, eye, birthDate, description,
            angel_dog, titles, pedigree
        } = req.body;

        const updateData: DogUpdate = {
            name,
            nickname,
            breed: breed || null,
            size: size || null,
            hair_type: hairType || null,
            reg_nr: regNr || null,
            gender: gender || null,
            color: color || null,
            ivdd: ivdd || null,
            bph: bph || null,
            eye: eye || null,
            birth_date: birthDate || null,
            description: description || null,
            angel_dog: angel_dog || null,
            titles: Array.isArray(titles) ? titles : [],
            pedigree: pedigree ?? null,
        };

        if (req.file) {
            const s3params: AWS.S3.PutObjectRequest = {
                Bucket: process.env.AWS_S3_BUCKET!,
                Key: `uploads/${req.file.originalname}`,
                Body: req.file.buffer,
                ContentType: req.file.mimetype,
            };

            const s3Data = await uploadToS3(s3params);
            const fileName = s3Data.Key.split("uploads/")[1];
            updateData.image = [fileName];
        }

        const { data, error } = await supabase
            .from("dogs")
            .update(updateData)
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

// GET all dogs
router.get("/", async (_req: Request, res: Response) => {
    try {
        const { data, error } = await supabase
            .from("dogs")
            .select("*")
            .order("id", { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        res.status(500).json({ message });
    }
});

// GET dog by id
router.get("/:id", async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from("dogs")
            .select("*")
            .eq("id", id)
            .single();

        if (error) return res.status(404).json({ message: "Cant find dog" });
        res.json(data);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        res.status(500).json({ message });
    }
});

// CREATE dog
router.post("/", requireAuth, upload.single("image"), async (req: MulterRequest, res: Response) => {
    try {
        const {
            name, nickname, breed, size, hair_type, reg_nr, gender,
            color, ivdd, bph, eye, birth_date, description,
            angel_dog, titles, pedigree
        } = req.body;

        let images: string[] = [];

        if (req.file) {
            const s3params: AWS.S3.PutObjectRequest = {
                Bucket: process.env.AWS_S3_BUCKET!,
                Key: `uploads/${req.file.originalname}`,
                Body: req.file.buffer,
                ContentType: req.file.mimetype,
            };

            const s3Data = await uploadToS3(s3params);
            images.push(s3Data.Location);
        }

        const { data, error } = await supabase
            .from("dogs")
            .insert([{
                name,
                nickname,
                breed: breed || null,
                size: size || null,
                hair_type: hair_type || null,
                reg_nr: reg_nr || null,
                gender: gender || null,
                color: color || null,
                ivdd: ivdd || null,
                bph: bph || null,
                eye: eye || null,
                birth_date: birth_date || null,
                description: description || null,
                angel_dog: angel_dog || null,
                titles: Array.isArray(titles) ? titles : [],
                pedigree: pedigree ? JSON.stringify(pedigree) : null,
                image: images,
            }])
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        res.status(400).json({ message });
    }
});

// DELETE dog
router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from("dogs")
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