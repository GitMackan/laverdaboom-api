import mongoose from "mongoose";

const DogSchema = new mongoose.Schema({
  name: { type: String, required: true },
  breed: { type: String, required: false },
  birthDate: { type: String, required: false },
  regNr: { type: Number, required: false },
  size: { type: String, required: false },
  gender: { type: String, required: false },
  color: { type: String, required: false },
  hairType: { type: String, required: false },
});

export const DogModel = mongoose.model("Dogs", DogSchema);

export const getDogs = () => DogModel.find();
export const getDogById = (id: string) => DogModel.findById(id);
export const createDog = (values: Record<string, any>) =>
  new DogModel(values).save().then((dog) => dog.toObject());
export const deleteDogById = (id: string) =>
  DogModel.findOneAndDelete({ _id: id });
export const updateDogById = (id: string, values: Record<string, any>) =>
  DogModel.findByIdAndUpdate(id, values);
