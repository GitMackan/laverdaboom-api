import express, { Request, Response as ExpressResponse } from "express";
const cors = require("cors");
const cookieParser = require("cookie-parser");
const compression = require("compression");
import dotenv from "dotenv";
import dogsRouter from "./routes/dogs";
import imagesRouter from "./routes/images";
import emailRouter from "./routes/email";
import productsRouter from "./routes/products";
import productVariantsRouter from "./routes/productVariants";
import productImagesRouter from "./routes/productImages";

dotenv.config();

const app = express();

app.use(cors({
    origin: ["http://localhost:3000", "https://laverdaboom.com"],
    credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use(compression());

app.get("/", (req: Request, res: ExpressResponse) => res.send("API is running"));



// Routes
app.use("/dogs", dogsRouter);
app.use("/images", imagesRouter);
app.use("/email", emailRouter);
app.use("/products", productsRouter);
app.use("/product-variants", productVariantsRouter);
app.use("/product-images", productImagesRouter);

app.listen(process.env.PORT || 8080, () => console.log(`Server started on port ${process.env.PORT || 8080}`));