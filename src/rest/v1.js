const jwt = require("jsonwebtoken");
const User = require("../mongo/models/User");
const userActions = require("../mongo/actions/User");
const signIn = async (req, res) => {
  const user = await User.findOne({ username: req.body.username });
  if (user && (await user.checkPassword(req.body.password))) {
    if (!user.activated)
      return res
        .status(403)
        .json({ error: "Your account has not yet been activated." });
    const token = jwt.sign(
      {
        user: user.id,
      },
      process.env.JWT_SECRET_KEY
    );
    res.status(200).json({ login: "success", token });
  } else {
    res.status(401).json({ error: "Incorrect username or password." });
  }
};

const signUp = async (req, res) => {
  if (req.body.password.length < 4) {
    return res
      .status(400)
      .json({ error: "Passwords must be at least four characters." });
  }
  await userActions.createUser(req.body);
  res.status(200).json({ signup: "success" });
};

const checkAuthorization = async (req, res) => {
  const token = req.headers.bearer;
  if (token) {
    try {
      const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findById(userData.user);
      if (user) {
        if (user.accountStatus === "2") {
          return res.status(403).json({ error: "You are banned from chat." });
        }
        return res.status(200).json({ login: "success" });
      }
    } catch (e) {
      return res.status(400).send({ error: e.message });
    }
  } else {
    return res.status(400).send("No token found. You can ignore this error.");
  }
};

const getBannedUsers = async (req, res) => {
  const token = req.headers.bearer;
  if (token) {
    try {
      const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findById(userData.user);
      if (user.role > 0) {
        const users = await userActions.getBannedUsers();
        res.status(200).json({ users });
      } else {
        res
          .status(403)
          .json("You do not have sufficient rights to access these records.");
      }
    } catch (e) {
      return res.status(400).send({ error: e.message });
    }
  } else {
    return res.status(401).json({ error: "Request missing access token" });
  }
};

const getUsers = async (req, res) => {
  const token = req.headers.bearer;
  if (token) {
    try {
      const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findById(userData.user);
      if (user.role > 0) {
        const users = await userActions.getUsers();

        res.status(200).json({ users });
      } else {
        res
          .status(403)
          .json("You do not have sufficient rights to access these records.");
      }
    } catch (e) {
      return res.status(400).send({ error: e.message });
    }
  } else {
    return res.status(401).json({ error: "Request missing access token" });
  }
};

const getBlockedUsers = async (req, res) => {
  const token = req.headers.bearer;
  if (token) {
    try {
      const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findById(userData.user);
      if (user.activated) {
        const names = await Promise.all(
          req.query.userIds.map(async (id) => {
            const user = await User.findById(id);
            if (user) return { userId: user.id, username: user.username };
          })
        );
        res.status(200).json({ names });
      } else {
        res
          .status(403)
          .json("You do not have sufficient rights to access these records.");
      }
    } catch (e) {
      return res.status(400).send({ error: e.message });
    }
  } else {
    return res.status(401).json({ error: "Request missing access token" });
  }
};

const deleteUser = async (req, res) => {
  const token = req.headers.bearer;
  if (token) {
    try {
      const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findById(userData.user);
      if (user.role === "2") {
        const deletingUser = await User.findById(req.body.userId);
        const result = await userActions.deleteUser(req.body.userId);

        res.status(200).json({ result });
      } else {
        res
          .status(403)
          .json("You do not have sufficient rights to modify these records.");
      }
    } catch (e) {
      return res.status(400).send({ error: e.message });
    }
  } else {
    return res.status(401).json({ error: "Request missing access token" });
  }
};

const logOut = async (req, res) => {
  if (req.headers.bearer) {
    return res.status(200).json({ logout: "success" });
  } else {
    return res.status(401).json({ error: "Request missing access token" });
  }
};

const updatePassword = async (req, res) => {
  if (req.headers.bearer) {
    const token = req.headers.bearer;
    const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
    const user = await User.findById(userData.user);
    if (user) {
      if (req.body.new.length < 4)
        return res
          .status(400)
          .json({ error: "Passwords must be at least four characters." });
      if (await user.checkPassword(req.body.old)) {
        await userActions.updatePassword(user, req.body.new);
        return res.status(200).json({ result: "Password Updated" });
      } else {
        return res.status(401).json({ error: "Incorrect password" });
      }
    } else {
      return res.status(404).json({ error: "User does not exist" });
    }
  } else {
    return res.status(401).json({ error: "Request missing access token" });
  }
};

const setPhoto = async (req, res) => {
  const token = req.headers.bearer;
  const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
  const user = await User.findById(userData.user);
  if (user) {
    const result = await userActions.setUserPhoto(user, req.body.photoURL);
    res.status(200).json({ result });
  } else {
    return res.status(404).json({ error: "User does not exist" });
  }
};
const getPendingUsers = async (req, res) => {
  if (req.headers.bearer) {
    const token = req.headers.bearer;
    const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
    const user = await User.findById(userData.user);
    if (user) {
      if (user.role > 0) {
        const pendingUsers = await userActions.getUnactivatedUsers();
        return res.status(200).json({ pendingUsers });
      }
    } else {
      return res.status(404).json({ error: "User does not exist" });
    }
  } else {
    return res.status(401).json({ error: "Request missing access token" });
  }
};

const confirmUser = async (req, res) => {
  if (req.headers.bearer) {
    const token = req.headers.bearer;
    const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
    const user = await User.findById(userData.user);
    if (user) {
      if (user.role > 0) {
        const activationResult = await userActions.activateUser(
          req.body.userId
        );
        return res.status(200).json({ activationResult });
      }
    } else {
      return res.status(404).json({ error: "User does not exist" });
    }
  } else {
    return res.status(401).json({ error: "Request missing access token" });
  }
};

module.exports = {
  checkAuthorization,
  confirmUser,
  deleteUser,
  getBannedUsers,
  getBlockedUsers,
  getPendingUsers,
  getUsers,
  logOut,
  setPhoto,
  signIn,
  signUp,
  updatePassword,
};
