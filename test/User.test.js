const userActions = require("../src/mongo/actions/User");
const mongoose = require("mongoose");
const chai = require("chai");
const expect = chai.expect;
const chaiAsPromised = require("chai-as-promised");
const User = require("../src/mongo/models/User");
const { userData } = require("./data/users");
chai.use(chaiAsPromised);

describe("UserActions", function () {
  before(function (done) {
    mongoose.connect("mongodb://localhost/chattr-test", {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    const db = mongoose.connection;
    db.on("error", console.error.bind(console, "connection error"));
    db.once("open", function () {
      done();
    });
  });

  describe("createUser({username, password, role})", function () {
    beforeEach(async function () {
      await mongoose.connection.dropDatabase();
      await User.insertMany(userData);
    });

    it("Should add a user to the db", async function () {
      const user = await userActions.createUser({
        username: "testuser",
        password: "testpassword",
        role: "0",
      });
      expect(user).to.have.property("username");
      expect(user.username).to.eql("testuser");
      expect(user.activated).to.eql(false);
      expect(user.role).to.eql("0");
    });

    it("Should prevent multiple users from signing up with the same userame", async function () {
      await userActions.createUser({
        username: "testuser",
        password: "testpassword",
        role: "0",
      });
      return expect(
        userActions.createUser({
          username: "testuser",
          password: "testpassword",
          role: "0",
        })
      ).to.eventually.be.rejectedWith("user exists");
    });
  });

  describe("deleteUser(userId)", function () {
    beforeEach(async function () {
      await mongoose.connection.dropDatabase();
      await User.insertMany(userData);
    });

    it("Should remove a user from the db", async function () {
      const userToDelete = await User.findOne({ username: "test1" });
      const deletionResult = await userActions.deleteUser(userToDelete.id);
      expect(deletionResult.result).to.eq(
        `${userToDelete.username} has been deleted from the database`
      );
    });

    it("Should reject ids cannot be cast to ObjectIds", function () {
      return expect(
        userActions.deleteUser("totally fake and invalid")
      ).to.eventually.be.rejectedWith("Cast to ObjectId failed");
    });

    it("Should return no user found for UIDS matching no users");
  });

  describe("banUser(userId)", function () {
    beforeEach(async function () {
      await mongoose.connection.dropDatabase();
      await User.insertMany(userData);
    });

    it("Should set a user's status to banned (2)", async function () {
      const testBanUser = await User.findOne({ username: "test1" });
      const userBanResult = await userActions.banUser(testBanUser.id);
      expect(userBanResult.accountStatus).to.eql("2");
    });
  });

  describe("setAccountStatus(userId, status)", function () {
    beforeEach(async function () {
      await mongoose.connection.dropDatabase();
      await User.insertMany(userData);
    });

    it("Should set a user's status to unbanned (0)", async function () {
      const user = await User.findOne({ username: "test1" });
      const setStatusResult = await userActions.setAccountStatus(user.id, "0");
      expect(setStatusResult.accountStatus).to.eql("0");
    });

    it("Should reject if no status is sent", async function () {
      const user = await User.findOne({ username: "test1" });
      return expect(userActions.setAccountStatus(user.id)).to.eventually.be
        .rejected;
    });
  });

  describe("addUserToBlockList(blockingUserId, blockedUserId)", function () {
    beforeEach(async function () {
      await mongoose.connection.dropDatabase();
      await User.insertMany(userData);
    });

    it("Should add a user to another's block list", async function () {
      const user = await User.findOne({ username: "test1" });
      const user2 = await User.findOne({ username: "test2" });
      const blockResult = await userActions.addUserToBlockList(
        user.id,
        user2.id
      );
      expect(blockResult.blocked).to.include(user2.id);
      expect(blockResult.blockedBy).to.include(user.id);
    });
  });

  describe("removeUserFromBlockList(unblockingUserId, unblockedUserId)", function () {
    beforeEach(async function () {
      await mongoose.connection.dropDatabase();
      await User.insertMany(userData);
    });

    it("Should remove a user from another's block list", async function () {
      const user = await User.findOne({ username: "test1" });
      const user2 = await User.findOne({ username: "test2" });
      user.blockedUsers.push(user2.id);
      user2.blockedBy.push(user.id);
      await Promise.all([user.save(), user2.save()]);

      const blockResult = await userActions.removeUserFromBlockList(
        user.id,
        user2.id
      );
      expect(blockResult.blocked).not.to.include(user2.id);
      expect(blockResult.blocked).to.be.an("array");
      expect(blockResult.blockedBy).not.to.include(user.id);
      expect(blockResult.blockedBy).to.be.an("array");
      expect(blockResult.result).to.eql(1);
    });
  });

  describe("readUser(username)", function () {
    beforeEach(async function () {
      await mongoose.connection.dropDatabase();
      await User.insertMany(userData);
    });
    it("Return user data matching the supplied username", async function () {
      const readUserResult = await userActions.readUser("test1");
      expect(readUserResult.username).to.eql("test1");
      expect(readUserResult.activated).to.eql(true);
    });
  });

  describe("updatePassword(user, password)", function () {
    beforeEach(async function () {
      await mongoose.connection.dropDatabase();
      await User.insertMany(userData);
    });

    it("Return user data matching the supplied username", async function () {
      const user = await User.findOne({ username: "test1" });
      const passwordUpdateResult = await userActions.updatePassword(
        user,
        "supercool"
      );
      expect(passwordUpdateResult.result).to.eql(1);
    });
  });

  describe("setUserPhoto(user, password)", function () {
    beforeEach(async function () {
      await mongoose.connection.dropDatabase();
      await User.insertMany(userData);
    });

    it("Return user data matching the supplied username", async function () {
      const user = await User.findOne({ username: "test1" });
      const setPhotoResult = await userActions.setUserPhoto(
        user,
        "http://www.example.com/photos/1.jpg"
      );
      expect(setPhotoResult.url).to.eql("http://www.example.com/photos/1.jpg");
    });
  });

  describe("updateUsername(user, username)", function () {
    beforeEach(async function () {
      await mongoose.connection.dropDatabase();
      await User.insertMany(userData);
    });

    it("Return user data matching the supplied username", async function () {
      const user = await User.findOne({ username: "test1" });
      const usernameUpdateResult = await userActions.updateUsername(
        user,
        "supercooltest"
      );
      expect(usernameUpdateResult.result).to.eql(1);
    });
  });

  describe("getBannedUsers()", function () {
    beforeEach(async function () {
      await mongoose.connection.dropDatabase();
      await User.insertMany(userData);
    });

    it("Returns banned users", async function () {
      const user = await User.findOne({ username: "test1" });
      user.accountStatus = 2;
      await user.save();
      const bannedUsers = await userActions.getBannedUsers();
      expect(bannedUsers).to.have.length(1);
    });
  });

  describe("getUnactivatedUsers()", function () {
    beforeEach(async function () {
      await mongoose.connection.dropDatabase();
      await User.insertMany(userData);
    });

    it("Returns users not yet activated", async function () {
      const unactivatedUsers = await userActions.getUnactivatedUsers();
      expect(unactivatedUsers).to.have.length(2);
    });
  });

  describe("getUsers()", function () {
    beforeEach(async function () {
      await mongoose.connection.dropDatabase();
      await User.insertMany(userData);
    });

    it("Returns all users regardless of status", async function () {
      const users = await userActions.getUsers();
      expect(users).to.have.length(userData.length);
    });
  });

  describe("getUsernameFromId(userId)", function () {
    beforeEach(async function () {
      await mongoose.connection.dropDatabase();
      await User.insertMany(userData);
    });

    it("Returns a current username from a user ID", async function () {
      const user = await User.findOne({ username: "test1" });
      const username = await userActions.getUsernameFromId(user.id);
      expect(username.username).to.eql("test1");
    });
  });

  describe("activateUser(userId)", function () {
    beforeEach(async function () {
      await mongoose.connection.dropDatabase();
      await User.insertMany(userData);
    });
    it("Returns a current username from a user ID", async function () {
      const user = await User.findOne({ activated: false });
      const activationResult = await userActions.activateUser(user.id);
      expect(activationResult.result).to.eql("User Activated");
    });
  });

  after(function (done) {
    mongoose.connection.db.dropDatabase(function () {
      mongoose.connection.close(done);
    });
  });
});
