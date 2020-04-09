const faker = require("faker");

const users = [
  {
    username: "admin",
    password: "admin",
    role: 2,
    activated: true,
  },
  {
    username: "test1",
    password: "test1",

    activated: true,
  },
  {
    username: "test2",
    password: "test2",
    activated: true,
  },
  {
    username: faker.internet.userName(),
    password: faker.internet.password(),
    role: 0,
  },
  {
    username: faker.internet.userName(),
    password: faker.internet.password(),
    role: 0,
  },
];
module.exports = {
  userData: users,
};
