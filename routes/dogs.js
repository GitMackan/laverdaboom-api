const express = require("express");
const { merge } = require("lodash");
const dog = require("../models/dog");
const router = express.Router();
const Dog = require("../models/dog");
const User = require("../models/user");
const Image = require("../models/image");
const aws = require("aws-sdk");
const multer = require("multer");

const s3 = new aws.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const storage = multer.memoryStorage();

const upload = multer({ storage: storage });

// Get all
router.get("/", async (req, res) => {
  try {
    const dogs = await Dog.find();
    res.json(dogs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get one by name
router.get("/:name", getDogByName, (req, res) => {
  res.json(res.dog);
});

// Create one
router.post("/", upload.single("image"), isAuthenticated, async (req, res) => {
  const dog = new Dog({
    name: req.body.name,
    breed: req.body.password,
    size: req.body.size,
    hairType: req.body.hairType,
    regNr: req.body.regNr,
    gender: req.body.gender,
    color: req.body.color,
    IVDD: req.body.IVDD,
    BPH: req.body.BPH,
    eye: req.body.eye,
    birthDate: req.body.birthDate,
    description: req.body.description,
    angelDog: req.body.angelDog,
    image: req.file && req.file.originalname,
  });

  const image = new Image({
    image: req.file && {
      data: req.file.buffer,
      contentType: req.file.mimetype,
    },
  });

  const s3params = req.file && {
    Bucket: process.env.AWS_S3_BUCKET,
    Key: `uploads/${req.file.originalname}`,
    Body: req.file.buffer,
    ContentType: req.file.mimetype,
  };

  if (req.file) {
    try {
      s3.upload(s3params, (err, data) => {
        if (err) {
          console.error(err);
          return res.status(500).send("Error uploading image to S3");
        }

        // Set the imageUrl to the public S3 URL
        image.imageUrl = data.Location;
        image.save();
      });

      const newDog = await dog.save();
      res.status(201).json("Allt gick bra!");
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  } else {
    try {
      const newDog = await dog.save();
      res.status(201).json("Allt gick bra!");
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  }
});

// Update
router.patch(
  "/:id",
  upload.single("file"),
  isAuthenticated,
  getDog,
  async (req, res) => {
    const image = new Image({
      image: req.file && {
        data: req.file.buffer,
        contentType: req.file.mimetype,
      },
    });

    const s3params = req.file && {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: `uploads/${req.file.originalname}`,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    };

    if (req.body.name != null) {
      res.dog.name = req.body.name;
    }
    if (req.body.breed != null) {
      res.dog.breed = req.body.breed;
    }
    if (req.body.size != null) {
      res.dog.size = req.body.size;
    }
    if (req.body.hairType != null) {
      res.dog.hairType = req.body.hairType;
    }
    if (req.body.regNr != null) {
      res.dog.regNr = req.body.regNr;
    }
    if (req.body.gender != null) {
      res.dog.gender = req.body.gender;
    }
    if (req.body.color != null) {
      res.dog.color = req.body.color;
    }
    if (req.body.IVDD != null) {
      res.dog.IVDD = req.body.IVDD;
    }
    if (req.body.BPH != null) {
      res.dog.BPH = req.body.BPH;
    }
    if (req.body.eye != null) {
      res.dog.eye = req.body.eye;
    }
    if (req.body.birthDate != null) {
      res.dog.birthDate = req.body.birthDate;
    }
    if (req.body.description != null) {
      res.dog.description = req.body.description;
    }
    if (req.body.angelDog != null) {
      res.dog.angelDog = req.body.angelDog;
    }
    if (req.body.titles != null) {
      res.dog.titles = req.body.titles;
    }
    if (res.dog.titles.length > 0 && req.body.titles == null) {
      res.dog.titles = [];
    }
    if (res.dog.pedigree != null) {
      res.dog.pedigree = req.body.pedigree;
    }
    if (!req.file) {
      if (req.body.image != null) {
        res.dog.image = req.body.image;
      } else {
        res.dog.image = [];
      }
    }
    if (req.file) {
      res.dog.image = [...res.dog.image, req.file.originalname];

      try {
        s3.upload(s3params, (err, data) => {
          if (err) {
            console.error(err);
            return res.status(500).send("Error uploading image to S3");
          }

          // Set the imageUrl to the public S3 URL
          image.imageUrl = data.Location;
          image.save();
        });

        const updatedDog = await res.dog.save();
        res.status(201).json("Allt gick bra!");
      } catch (error) {
        res.status(400).json({ message: error.message });
      }
    } else {
      try {
        const updatedDog = await res.dog.save();
        res.json(updatedDog);
      } catch (error) {
        res.status(400).json({ message: error.message });
      }
    }
  }
);

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

// Middleware
async function getDogByName(req, res, next) {
  let dog;
  try {
    dog = await Dog.findOne({ name: req.params.name });
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
    const sessionToken = req.body.sessionToken;

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
