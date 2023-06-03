const express = require("express");
const router = express.Router();
const User = require("../models/user");
const jwt = require("jsonwebtoken");

router.post("/", async (req, res) => {
  try {
    const { username, password } = req.body;
    const tokenObj = { username: username, password: password };

    const SECRET = "LAVERDABOOM-API";

    const sessionToken = jwt.sign(tokenObj, SECRET, {
      expiresIn: "15m",
    });

    if (!username || !password) {
      return res.sendStatus(400);
    }

    const existingUser = await User.findOne({ username });

    if (existingUser) {
      return res.sendStatus(400);
    }

    const createUser = (values) => new User(values).save();

    const user = await createUser({
      username,
      password,
      sessionToken,
    });

    return res.status(200).json(user).end();
  } catch (error) {
    console.log(error);
    return res.sendStatus(400);
  }
});

module.exports = router;
