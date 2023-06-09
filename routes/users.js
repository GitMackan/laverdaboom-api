const express = require("express");
const { merge } = require("lodash");
const router = express.Router();
const User = require("../models/user");

// Get all
router.get("/", isAuthenticated, async (req, res) => {
  try {
    const users = await User.find();
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get one
router.get("/:id", getUser, isAuthenticated, (req, res) => {
  res.json(res.user);
});

// Create one
router.post("/", isAuthenticated, async (req, res) => {
  const user = new User({
    email: req.body.email,
    username: req.body.username,
    password: req.body.password,
  });

  try {
    const newUser = await user.save();
    res.status(201).json(newUser);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update
router.patch("/:id", isAuthenticated, getUser, async (req, res) => {
  if (req.body.username != null) {
    res.user.username = req.body.username;
  }
  if (req.body.password != null) {
    res.user.password = req.body.password;
  }

  try {
    const updatedUser = await res.user.save();
    res.json(updatedUser);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete one
router.delete("/:id", isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const deletedUser = await User.findByIdAndDelete(id);
    res.json(deletedUser);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

async function getUser(req, res, next) {
  let user;
  try {
    user = await User.findById(req.params.id);
    if (!user) {
      return send.status(404).json({ message: "Cant find user" });
    }
  } catch (error) {
    return send.status(500).json({ message: error.message });
  }

  res.user = user;
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
