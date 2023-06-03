const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema({
  image: {
    data: Buffer,
    contentType: String,
  },
});

module.exports = mongoose.model("Image", imageSchema);
