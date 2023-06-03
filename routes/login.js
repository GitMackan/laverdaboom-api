const express = require("express");
const router = express.Router();
const User = require("../models/user");
const jwt = require("jsonwebtoken");

router.post("/", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username: username, password: password });

    const tokenObj = { username: username, password: password };

    // const SECRET = "LAVERDABOOM-API";
    console.log(process.env.SECRET);

    const sessionToken = jwt.sign(tokenObj, process.env.SECRET, {
      expiresIn: "15m",
    });

    user.sessionToken = sessionToken;

    const updatedUser = await user.save();

    res.cookie("LAVERDABOOM-AUTH", sessionToken, {
      domain: "localhost",
      path: "/",
    });
    res.status(200).json({ sessionToken: sessionToken });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
