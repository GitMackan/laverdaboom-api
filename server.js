const express = require("express");
const app = express();
const mongoose = require("mongoose");

const connectToDatabase = async () => {
  try {
    await mongoose.connect(process.env.DATABASE_URL);
    console.log("Connected to database");
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
};

connectToDatabase();

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Api is running");
});

const usersRouter = require("./routes/users");
app.use("/users", usersRouter);

app.listen(process.env.PORT || 8080, () => console.log("Server has started"));
