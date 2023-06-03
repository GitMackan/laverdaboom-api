const express = require("express");
const router = express.Router();
const User = require("../models/user");
const Image = require("../models/image");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const aws = require("aws-sdk");

// const storage = multer.diskStorage({
//   destination: function (req, file, cb) {
//     cb(null, __dirname + "/uploads");
//   },
//   filename: function (req, file, cb) {
//     cb(
//       null,
//       file.fieldname + "-" + Date.now() + path.extname(file.originalname)
//     );
//   },
// });

// const upload = multer({ storage: storage });

const s3 = new aws.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

// const storage = multer.diskStorage({
//   destination: function (req, file, cb) {
//     cb(null, "uploads/");
//   },
//   filename: function (req, file, cb) {
//     cb(null, file.originalname);
//   },
// });

const storage = multer.memoryStorage();

const upload = multer({ storage: storage });

// Get all
router.get("/", async (req, res) => {
  try {
    const images = await Image.find();
    res.status(200).json(images);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get one
router.get("/:id", getDog, (req, res) => {});

// Create one
router.post("/", upload.single("image"), async (req, res) => {
  const image = new Image({
    image: {
      data: req.file.buffer,
      contentType: req.file.mimetype,
    },
  });

  // Upload the image to Amazon S3
  const s3params = {
    Bucket: process.env.AWS_S3_BUCKET,
    Key: `uploads/${req.file.originalname}`,
    Body: req.file.buffer,
    ContentType: req.file.mimetype,
  };

  s3.upload(s3params, (err, data) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error uploading image to S3");
    }

    // Set the imageUrl to the public S3 URL
    image.imageUrl = data.Location;
    image.save();

    return res.status(200).json({
      message: "Image uploaded successfully",
      imageUrl: data.Location,
    });
  });
});

// Delete one
router.delete("/:id", isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const deletedDog = await Dog.findByIdAndDelete(id);
    res.json(deletedDog);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Middleware
async function getDog(req, res, next) {
  let dog;
  try {
    dog = await Dog.findById(req.params.id);
    if (!dog) {
      return send.status(404).json({ message: "Cant find dog" });
    }
  } catch (error) {
    return send.status(500).json({ message: error.message });
  }

  res.dog = dog;
  next();
}

async function isAuthenticated(req, res, next) {
  try {
    const sessionToken = req.cookies["LAVERDABOOM-AUTH"];

    if (!sessionToken) {
      return res.sendStatus(403);
    }

    const existingUser = await User.findOne({ sessionToken: sessionToken });

    if (!existingUser) {
      return res.sendStatus(403);
    }

    return next();
  } catch (error) {
    console.log(error);
    return res.sendStatus(400);
  }
}

module.exports = router;
