const express = require("express");
const app = express();
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const multer = require("multer");
const path = require("path");
const { countBy } = require("lodash");

// const storage = multer.diskStorage({
//   destination: function (req, file, cb) {
//     cb(null, "uploads");
//   },
//   filename: function (req, file, cb) {
//     cb(
//       null,
//       file.fieldname + "-" + Date.now() + path.extname(file.originalname)
//     );
//   },
// });

// const upload = multer({ storage: storage });

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
app.use(
  cors({
    origin: "https://laverdaboom.com",
    credentials: true,
  })
);
app.use(cookieParser());
app.use(compression());
app.set("view engine", "ejs");

app.get("/", (req, res) => {
  res.send("Api is running");
});

const usersRouter = require("./routes/users");
const dogsRouter = require("./routes/dogs");
const registerRouter = require("./routes/register");
const loginRouter = require("./routes/login");
const imagesRouter = require("./routes/images");
const emailRouter = require("./routes/email");

app.use("/users", usersRouter);
app.use("/dogs", dogsRouter);
app.use("/login", loginRouter);
app.use("/register", registerRouter);
app.use("/images", imagesRouter);
app.use("/email", emailRouter);

app.listen(process.env.PORT, () => console.log("Server has started"));
