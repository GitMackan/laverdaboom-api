const mongoose = require("mongoose");

const dogSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  nickName: {
    type: String,
    required: true,
  },
  breed: {
    type: String,
    required: false,
  },
  size: {
    type: String,
    required: false,
  },
  hairType: {
    type: String,
    required: false,
  },
  regNr: {
    type: String,
    required: false,
  },
  gender: {
    type: String,
    required: false,
  },
  color: {
    type: String,
    required: false,
  },
  IVDD: {
    type: String,
    required: false,
  },
  BPH: {
    type: String,
    required: false,
  },
  eye: {
    type: String,
    required: false,
  },
  birthDate: {
    type: String,
    required: false,
  },
  description: {
    type: String,
    required: false,
  },
  angelDog: {
    type: String,
    required: false,
  },
  size: {
    type: String,
    required: false,
  },
  titles: {
    type: [String],
    required: false,
  },
  pedigree: {
    type: [Object],
    required: false,
  },
  image: [
    {
      type: String,
    },
  ],
});

module.exports = mongoose.model("Dog", dogSchema);
