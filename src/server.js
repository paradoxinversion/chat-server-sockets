const environment = process.env.NODE_ENV;
const config = require("./config/config").getConfig();
const app = require("express")();
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const http = require("http").createServer(app);
const setupdb = require("./mongo/setupdb");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const jdenticon = require("jdenticon");
const io = require("socket.io")(http, {
  cookie: false
});
const userActions = require("./mongo/actions/User");
const User = require("./mongo/models/User");
io.origins("*:*");

// CORS is set in nginx in production
if (environment !== "production") {
  const cors = require("cors");
  app.use(cors({ origin: "http://localhost:3000", credentials: true }));
}

const database = setupdb(false);
passport.use(
  new LocalStrategy(async function(username, password, done) {
    const user = await User.findOne({ username: username });

    if (!user) {
      return done(null, false, { message: "Incorrect username." });
    }
    if (!user.checkPassword(password)) {
      return done(null, false, { message: "Incorrect password." });
    }
    return done(null, user);
  })
);

passport.serializeUser(function(user, done) {
  done(null, user.id);
});

passport.deserializeUser(async function(id, done) {
  const user = User.findById(id);
  done(null, user);
});

app.use(passport.initialize());
app.use(cookieParser());
app.use(require("express").json());

let chatClients = [];

const createUser = (clientId, user) => {
  return {
    username: user.username,
    avatar: jdenticon.toPng(user.username, 150),
    id: clientId,
    iid: user.iid,
    blockList: user.blockList,
    blockedBy: user.blockedBy,
    role: user.role,
    accountStatus: user.accountStatus,
    profilePhotoURL: user.profilePhotoURL
  };
};

/**
 * Adds a chat client to the `chatClients` array if one doesn't
 * already exist.
 * @param {*} client - A socket client
 */
const addChatClient = (client, user) => {
  let clientExists = false;
  for (let x = 0; x < chatClients.length; x++) {
    const chatClient = chatClients[x];
    if (chatClient.id === client.id) client = true;
  }

  // If none exists yet, add it
  if (!clientExists) {
    client.user = createUser(client.id, user);
    chatClients.push(client);
  }
  return client;
};

const removeChatClient = clientId => {
  chatClients = chatClients.filter(client => client.id !== clientId);
  return chatClients;
};

/**
 * Return an array of chat users (from the clients array)
 */
const getChatUsers = () => chatClients.map(client => client.user);

const getUserByName = username => {
  return chatClients.find(client => {
    return client.user.username === username;
  });
};

const getClientBySocketId = socketId => {
  return chatClients.find(client => {
    return client.id === socketId;
  });
};

// Authorization/preconnection logic
io.use(async (socket, next) => {
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
      blockList: dbUser.blockedUsers,
      blockedBy: dbUser.blockedBy,
      role: dbUser.role,
      accountStatus: dbUser.accountStatus,
      profilePhotoURL: dbUser.profilePhotoURL
    };
    if (dbUser) return next();

    return next(new Error("No user found"));
  } catch (e) {
    console.log(e);
  }
});

io.on("connection", function(socket) {
  addChatClient(socket.client, socket.user);
  socket.emit("user-connected", {
    user: socket.client.user
  });
  socket.emit("chat-message-broadcast", {
    id: "system",
    time: Date.now(),
    message: "Welcome to the chatroom!"
  });
  io.emit("room-user-change", {
    users: getChatUsers(),
    message: `${socket.client.user.username} has entered the chat room.`,
    user: socket.client.user
  });

  socket.on("chat-message-sent", function(data) {
    if (socket.client.user.accountStatus > 0) {
      return; // user is banned, don't bother
    }
    let message;
    if (data.isServerMessage) {
      message = {
        id: "system",
        time: Date.now(),
        message: data.message
      };
    } else {
      message = {
        id: socket.id,
        user: socket.client.user,
        message: data.message,
        time: Date.now(),
        from: data.from || "",
        fromUID: data.fromUID || "",
        to: data.to || "",
        toUID: data.toUID || ""
      };
    }

    if (data.to) {
      socket.to(data.to).emit("pm", message);
      socket.emit("pm", message);
    } else {
      io.emit("chat-message-broadcast", message);
    }
  });

  socket.on("get-banned-users", async function() {
    const bannedUsers = await userActions.getBannedUsers();
    socket.emit("get-banned-users", { users: bannedUsers });
  });

  socket.on("ban-user", async function(userSocketId) {
    // Get the user's db id
    const userIID = getClientBySocketId(userSocketId).user.iid;

    // ban the user in the db
    const banResult = await userActions.setAccountStatus(userIID, 2);

    // emit the ban to the room (to remove from their user lists)
    io.emit("ban-user", { bannedUser: banResult.username });

    // emit the ban to the banned user
    io.sockets.sockets[userSocketId].emit("account-status-change", {
      accountStatus: 2
    });
    // Disconnect the user
    io.sockets.sockets[userSocketId].disconnect(true);
  });

  socket.on("change-user-account-status", async function({ userIID, status }) {
    const statusStrings = {
      "0": "Normal",
      "1": "Muted",
      "2": "Banned"
    };
    const statusChange = await userActions.setAccountStatus(userIID, status);
    io.emit("change-user-account-status", {
      user: statusChange.username,
      status: statusStrings[status]
    });
    io.sockets.sockets[userSocketId].emit("targeted-user-notice", {
      message: "Your account status has been set to " + statusStrings[status]
    });
  });
  socket.on("block-user", async function(userSocketId) {
    const userIID = getClientBySocketId(userSocketId).user.iid;
    const blockResult = await userActions.addUserToBlockList(
      socket.client.user.iid,
      userIID
    );
    socket.emit("block-user", { blocklist: blockResult.blocked });
    io.sockets.sockets[userSocketId].emit("block-user", {
      blockedBy: blockResult.blockedBy
    });
  });

  socket.on("unblock-user", async function(userSocketId) {
    const userIID = getClientBySocketId(userSocketId).user.iid;
    const unblockResult = await userActions.removeUserFromBlockList(
      socket.client.user.iid,
      userIID
    );
    socket.emit("unblock-user", { blocklist: unblockResult.blocked });
    io.sockets.sockets[userSocketId].emit("unblock-user", {
      blockedBy: unblockResult.blockedBy
    });
  });

  socket.on("private-chat-initiated", function(userId) {
    const [p1, p2] = [socket.id, userId].sort((a, b) => a - b);
    const roomName = `${p1}-${p2}`;

    Promise.all([
      socket.join(roomName),
      io.sockets.sockets[userId].join(roomName)
    ]);

    io.to(roomName).emit("private-chat-initiated", roomName);
  });

  socket.on("set-username", async function({ username, user }) {
    const existingUser = getUserByName(username);
    if (!existingUser) {
      const clientUser = await User.findById(user);
      const oldName = socket.client.user.username;
      socket.client.user.username = username;
      await userActions.updateUsername(clientUser, username);
      io.emit("room-user-change", {
        users: getChatUsers(),
        message: `${oldName} is now ${socket.client.user.username}.`,
        user: socket.client.user
      });
    } else {
      socket.emit("set-username-error", "Username Taken");
    }
  });

  socket.on("set-user-photo", async function({ userId, photoURL }) {
    const user = await User.findById(userId);
    console.log(user);
    if (user) {
      await userActions.setUserPhoto(user, photoURL);
      socket.client.user.profilePhotoURL = photoURL;
      io.emit("room-user-update", {
        users: getChatUsers()
      });
    }
  });
  socket.on("disconnect", function() {
    removeChatClient(socket.id);
    io.emit("user-disconnected", { username: socket.client.user });
    io.emit("room-user-change", {
      users: getChatUsers(),
      message: `${socket.client.user.username} has left the chat room.`,
      user: socket.client.user
    });
  });
});

app.post(`/chattr/sign-in`, async (req, res) => {
  const user = await User.findOne({ username: req.body.username });
  if (user && (await user.checkPassword(req.body.password))) {
    if (!user.activated) return res.json({ error: "Not activated!" });
    const token = jwt.sign(
      {
        user: user.id
      },
      process.env.JWT_SECRET_KEY
    );
    res.status(200).json({ login: "success", token });
  } else {
    res.status(401).json({ error: "Incorrect username or password." });
  }
});

app.post(`/chattr/sign-up`, async (req, res) => {
  await userActions.createUser(req.body);
  res.status(200).json({ signup: "success" });
});

app.get(`/chattr/check-auth`, async (req, res) => {
  const token = req.headers.bearer;
  if (token) {
    try {
      const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findById(userData.user);
      if (user) res.status(200).json({ login: "success" });
    } catch (e) {
      return res.status(400).send({ error: e.message });
    }
  } else {
    return res.status(401).json({ error: "Request missing access token" });
  }
});

app.get(`/chattr/logout`, async (req, res) => {
  if (req.headers.bearer) {
    // console.log(req.headers.)
    return res.status(200).json({ logout: "success" });
  } else {
    return res.status(401).json({ error: "Request missing access token" });
  }
});

app.post(`/chattr/update-password`, async (req, res) => {
  if (req.headers.bearer) {
    const token = req.headers.bearer;
    const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
    const user = await User.findById(userData.user);
    if (user) {
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
});

app.post(`/chattr/set-photo`, async (req, res) => {
  const token = req.headers.bearer;
  const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
  const user = await User.findById(userData.user);
  if (user) {
    const result = await userActions.setUserPhoto(user, req.body.photoURL);
    res.status(200).json({ result });
  } else {
    return res.status(404).json({ error: "User does not exist" });
  }
});
app.get(`/chattr/pending-users`, async (req, res) => {
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
});

app.post(`/chattr/confirm-user`, async (req, res) => {
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
});
http.listen(config.server.port, async function() {
  console.log(`Listening on port ${config.server.port}`);
  const admin = await User.findOne({ role: 2 });
  if (!admin) {
    console.log(
      "No Administrator-- Creating default admin. Change the password as soon as possible"
    );
    const adminUser = await userActions.createUser({
      username: process.env.DEFAULT_ADMIN_USERNAME,
      password: process.env.DEFAULT_ADMIN_PASSWORD
    });
    adminUser.role = 2;
    adminUser.activated = true;
    await adminUser.save();
  }
});
