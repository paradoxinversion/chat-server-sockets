const jwt = require("jsonwebtoken");

const signToken = (userId) => {
  const token = jwt.sign(
    {
      user: userId,
    },
    process.env.JWT_SECRET_KEY
  );
  return token;
};

const verifyToken = (token) => {
  const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
  return userData;
};

module.exports = {
  signToken,
  verifyToken,
};
