const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const Schema = mongoose.Schema;
/***
 * Roles:
 * 0 - User
 * 1 - Admin
 */
const UserSchema = new Schema({
  username: String,
  password: String,
  role: String,
  blockedUsers: [String]
});

UserSchema.methods.checkPassword = async function(password) {
  return bcrypt.compare(password, this.password);
};

const User = mongoose.model("User", UserSchema);
module.exports = User;
