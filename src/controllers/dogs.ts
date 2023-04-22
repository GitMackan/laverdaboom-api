import express from "express";

import {
  createDog,
  deleteDogById,
  DogModel,
  getDogById,
  getDogs,
  updateDogById,
} from "../db/dogs";

export const createNewDog = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const { name, breed, birthDate, regNr, size, gender, color, hairType } =
      req.body;

    if (!name) {
      return res.sendStatus(400);
    }

    const dog = await createDog({
      name,
      breed,
      birthDate,
      regNr,
      size,
      gender,
      color,
      hairType,
    });

    return res.status(200).json(dog).end();
  } catch (error) {
    console.log(error);
    return res.sendStatus(400);
  }
};

export const getAllDogs = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const dogs = await getDogs();

    return res.status(200).json(dogs);
  } catch (error) {
    console.log(error);
    return res.sendStatus(400);
  }
};

export const deleteDog = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const { id } = req.params;

    const deletedDog = await deleteDogById(id);

    return res.json(deletedDog);
  } catch (error) {
    console.log(error);
    return res.sendStatus(400);
  }
};

export const updateDog = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const { id } = req.params;
    const { name, breed } = req.body;

    if (!req.body) {
      return res.sendStatus(400);
    }

    const dog = await getDogById(id);

    if (name) {
      dog.name = name;
    }

    if (breed) {
      dog.breed = breed;
    }

    await dog.save();

    return res.status(200).json(dog).end();
  } catch (error) {
    console.log(error);
    return res.sendStatus(400);
  }
};
