const express = require("express");
const app = express();
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const compression = require("compression");

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

require("dotenv").config();

const connectToDatabase = async () => {
  try {
    await mongoose.connect(process.env.DATABASE_URL);
    console.log("Connected to database");
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
};

const pedigree = [];

connectToDatabase();

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);
app.use((req, res, next) => {
  const allowedOrigins = ["http://localhost:3000", "https://laverdaboom.com"];

  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }

  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-PINGOTHER"
  );
  res.header("Access-Control-Allow-Credentials", true);
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS"
  );
  next();
});
app.use(express.json());
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

app.listen(process.env.PORT || 8080, () => console.log("Server has started"));
