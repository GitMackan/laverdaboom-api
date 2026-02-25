const express = require("express");
const router = express.Router();
const multer = require("multer");
const AWS = require("aws-sdk");
const supabase = require("../supabase");

const storage = multer.memoryStorage();
const upload = multer({ storage });

// AWS S3 setup
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
});

// GET all images
router.get("/", async(req, res) => {
    try {
        const { data, error } = await supabase.from("images").select("*").order("id", { ascending: true });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// POST / upload image
router.post("/", upload.single("image"), async(req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        // Upload to S3
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

        const imageUrl = s3Data.Location;

        // Insert URL into Supabase
        const { data, error } = await supabase.from("images").insert([{ image_url: imageUrl }]).select().single();
        if (error) throw error;

        res.status(201).json({ message: "Image uploaded successfully", image: data });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// DELETE image
router.delete("/:id", async(req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase.from("images").delete().eq("id", id).select().single();
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;