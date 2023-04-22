const express = require("express");
const app = express();
const mongoose = require("mongoose");

mongoose.connect(process.env.DATABASE_URL);

const db = mongoose.connection;
db.on("error", (error) => console.error(error));
db.once("open", () => console.log("Connected to database"));

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Api is running");
});

const usersRouter = require("./routes/users");
app.use("/users", usersRouter);

app.listen(process.env.PORT || 8080, () => console.log("Server has started"));
