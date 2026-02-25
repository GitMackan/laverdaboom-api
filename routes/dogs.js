const express = require("express");
const router = express.Router();
const multer = require("multer");
const AWS = require("aws-sdk");
const supabase = require("../supabase");

console.log("hej")

// Multer memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage });

// AWS S3 setup
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
});

// UPDATE dog
router.put("/:id", upload.single("image"), async(req, res) => {
    console.log("kom hit")
    try {
        const { id } = req.params;
        const {
            name,
            nickname,
            breed,
            size,
            hair_type,
            reg_nr,
            gender,
            color,
            ivdd,
            bph,
            eye,
            birth_date,
            description,
            angel_dog,
            titles,
            pedigree
        } = req.body;

        let updateData = {
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
        };

        // Om ny bild skickas med, ladda upp till S3
        if (req.file) {
            const s3params = {
                Bucket: process.env.AWS_S3_BUCKET,
                Key: `uploads/${req.file.originalname}`,
                Body: req.file.buffer,
                ContentType: req.file.mimetype,
            };

            const s3Data = await new Promise((resolve, reject) => {
                s3.upload(s3params, (err, data) => {
                    if (err) return reject(err);
                    resolve(data);
                });
            });

            updateData.image = [s3Data.Location];
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
        res.status(500).json({ message: err.message });
    }
});

// GET all dogs
router.get("/", async(req, res) => {
    console.log("hej2")
    try {
        const { data, error } = await supabase
            .from("dogs")
            .select("*")
            .order("id", { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// GET dog by id
router.get("/:id", async(req, res) => {
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
        res.status(500).json({ message: err.message });
    }
});

// CREATE dog
router.post("/", upload.single("image"), async(req, res) => {
    try {
        const {
            name,
            nickname,
            breed,
            size,
            hair_type,
            reg_nr,
            gender,
            color,
            ivdd,
            bph,
            eye,
            birth_date,
            description,
            angel_dog,
            titles,
            pedigree
        } = req.body;

        // Hantera image
        let images = [];
        if (req.file) {
            const s3params = {
                Bucket: process.env.AWS_S3_BUCKET,
                Key: `uploads/${req.file.originalname}`,
                Body: req.file.buffer,
                ContentType: req.file.mimetype,
            };

            const s3Data = await new Promise((resolve, reject) => {
                s3.upload(s3params, (err, data) => {
                    if (err) return reject(err);
                    resolve(data);
                });
            });

            images.push(s3Data.Location);
        }

        // Säkerställ array och JSON
        const safeTitles = Array.isArray(titles) ? titles : [];
        const safePedigree = pedigree ? JSON.stringify(pedigree) : null;

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
                titles: safeTitles,
                pedigree: safePedigree,
                image: images
            }])
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);

    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// DELETE dog
router.delete("/:id", async(req, res) => {
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
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;