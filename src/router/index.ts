import express from "express";

import authentication from "./authentication";
import dogs from "./dogs";
import users from "./users";

const router = express.Router();

export default (): express.Router => {
  authentication(router);
  users(router);
  dogs(router);

  return router;
};
