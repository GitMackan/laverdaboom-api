import express from "express";
import { isAuthenticated } from "../middlewares";

import {
  createNewDog,
  deleteDog,
  getAllDogs,
  updateDog,
} from "../controllers/dogs";

export default (router: express.Router) => {
  router.get("/dogs", getAllDogs);
  router.post("/dogs", isAuthenticated, createNewDog);
  router.delete("/dogs/:id", isAuthenticated, deleteDog);
  router.patch("/dogs/:id", isAuthenticated, updateDog);
};
