const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const compression = require("compression");
require("dotenv").config();

const app = express();

app.use(cors({
    origin: ["http://localhost:3000", "https://laverdaboom.com"],
    credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use(compression());

app.get("/", (req, res) => res.send("API is running"));

// Routes
const dogsRouter = require("./routes/dogs");
app.use("/dogs", dogsRouter);

const imagesRouter = require("./routes/images");
app.use("/images", imagesRouter);

const emailRouter = require("./routes/email");
app.use("/email", emailRouter);

app.listen(process.env.PORT || 8080, () => console.log(`Server started on port ${process.env.PORT || 8080}`));