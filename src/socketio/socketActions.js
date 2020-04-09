const jwt = require("jsonwebtoken");
const User = require("../mongo/models/User");

/**
 * Handles preconnection/authorization of incoming socket connections.
 * This is generally passed to `io.use`. Returns an error if no
 * user is found.
 * @param {*} socket
 * @param {*} next
 */
const authorizeSocket = async (socket, next) => {
  try {
    const userToken = socket.handshake.query.token;
    if (!userToken) next(new Error("No token provided"));

    const userData = jwt.verify(userToken, process.env.JWT_SECRET_KEY);
    if (!userData) next(new Error("Invalid user token"));

    const dbUser = await User.findById(userData.user);
    if (dbUser.accountStatus == "2") return next(new Error("You are banned."));
    socket.user = {
      username: dbUser.username,
      iid: dbUser.id,
      userId: dbUser.id,
      blockList: dbUser.blockedUsers,
      blockedBy: dbUser.blockedBy,
      role: dbUser.role,
      accountStatus: dbUser.accountStatus,
      profilePhotoURL: dbUser.profilePhotoURL,
    };
    if (dbUser) return next();

    return next(new Error("No user found"));
  } catch (e) {
    console.log(e);
  }
};

module.exports = {
  authorizeSocket,
};
