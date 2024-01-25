const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (error) {
    console.log(`DB Error : ${error.message}`);
    process.exit(1);
  }
};
initializeDBAndServer();

//Getting Array Of User Following ID's
const getFollowingPeopleIdsOfUser = async (username) => {
  const getTheFollowingPeopleQuery = `SELECT following_user_id FROM follower
  INNER JOIN user ON user.user_id = follower.follower_user_id
  WHERE user.username='${username}';`;

  const followingPeople = await db.all(getTheFollowingPeopleQuery);
  const arrayOfIds = followingPeople.map(
    (eachUser) => eachUser.following_user_id
  );
  return arrayOfIds;
};

//Authentication Token
// Authentication Token
const authentication = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];

  if (authHeader) {
    jwtToken = authHeader.split(" ")[1];
  }

  console.log("Received JWT Token:", jwtToken);

  if (jwtToken) {
    jwt.verify(jwtToken, "SECRET_KEY", (error, payload) => {
      if (error) {
        console.error("JWT Verification Error:", error.message);
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        console.log("JWT Token Verified. Payload:", payload);
        request.username = payload.username;
        request.userId = payload.userId;
        next();
      }
    });
  } else {
    console.error("No JWT Token provided in the request.");
    response.status(401);
    response.send("Invalid JWT Token");
  }
};

//Tweet Access Verification
const tweetAccessVerification = async (request, response, next) => {
  const { userId } = request;
  const { tweetId } = request.params;

  const getTweetQuery = `
    SELECT *
    FROM tweet
    INNER JOIN follower ON tweet.user_id = follower.following_user_id
    WHERE tweet.tweet_id = ? AND follower_user_id = ?;
  `;

  const tweet = await db.get(getTweetQuery, [tweetId, userId]);

  if (!tweet) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//API - 1
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const userDBDetails = await db.get(getUserQuery);

  //STEP - 1
  if (userDBDetails !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    //STEP - 2
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      //STEP - 3
      const hashedPassword = await bcrypt.hash(password, 10);
      const createUserQuery = `INSERT INTO user(username, password, name, gender)
            VALUES ('${username}','${hashedPassword}','${name}','${gender}')`;
      await db.run(createUserQuery);
      response.send("User created successfully");
    }
  }
});

//API - 2
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const userDBDetails = await db.get(getUserQuery);

  if (userDBDetails !== undefined) {
    const isPasswordCorrect = await bcrypt.compare(
      password,
      userDBDetails.password
    );

    if (isPasswordCorrect) {
      const payload = { username, userId: userDBDetails.user_id };
      const jwtToken = jwt.sign(payload, "SECRET_KEY");
      response.send({ jwtToken });
    } else {
      //STEP - 2
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    //STEP - 2
    response.status(400);
    response.send("Invalid user");
  }
});

// API-3
app.get("/user/tweets/feed", authentication, async (request, response) => {
  try {
    const { username } = request;

    // Get the user ID of the current user
    const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
    const { user_id } = await db.get(getUserIdQuery);

    // Get the user IDs of people whom the user follows
    const followingPeopleIds = await getFollowingPeopleIdsOfUser(username);

    // Fetch the latest 4 tweets of people whom the user follows
    const getTweetsQuery = `
      SELECT user.username, tweet.tweet, tweet.date_time as dateTime
      FROM tweet
      INNER JOIN user ON tweet.user_id = user.user_id
      WHERE tweet.user_id IN (${followingPeopleIds.join(",")})
      ORDER BY tweet.date_time DESC
      LIMIT 4;
    `;

    const tweets = await db.all(getTweetsQuery);
    response.json(tweets);
  } catch (error) {
    console.error("Error fetching user feed:", error.message);
    response.status(500).send("Internal Server Error");
  }
});

//API - 4
app.get("/user/following/", authentication, async (request, response) => {
  const { username, userId } = request;
  const getFollowingUserQuery = `SELECT name FROM follower 
    INNER JOIN user ON user.user_id = follower.following_user_id 
    WHERE follower_user_id = '${userId}';`;

  const followingPeople = await db.all(getFollowingUserQuery);
  response.send(followingPeople);
});

//API - 5
app.get("/user/followers/", authentication, async (request, response) => {
  const { username, userId } = request;
  const getFollowersQuery = `SELECT DISTINCT name FROM follower 
    INNER JOIN user ON user.user_id = follower.follower_user_id 
    WHERE following_user_id = '${userId}';`;

  const followers = await db.all(getFollowersQuery);
  response.send(followers);
});

//API - 6
app.get(
  "/tweets/:tweetId/",
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const { username, userId } = request;
    const { tweetId } = request.params;
    const getTweetQuery = `SELECT tweet,
    (SELECT COUNT() FROM like WHERE tweet_id = '${tweetId}') AS likes,
    (SELECT COUNT() FROM reply WHERE tweet_id = '${tweetId}') AS replies,
    date_time AS dateTime
    FROM tweet
    WHERE tweet.tweet_id = '${tweetId}';`;

    const tweet = await db.get(getTweetQuery);
    response.send(tweet);
  }
);

//API-7
app.get(
  "/tweets/:tweetId/likes",
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getLikesQuery = `SELECT username
    FROM user INNER JOIN like ON user.user_id = like.user_id
    WHERE tweet_id = '${tweetId}';`;

    const likedUsers = await db.all(getLikesQuery);
    const usersArray = likedUsers.map((eachUser) => eachUser.username);
    response.send({ likes: usersArray });
  }
);

//API-8
app.get(
  "/tweets/:tweetId/replies",
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getRepliedQuery = `SELECT name, reply
    FROM user INNER JOIN reply ON user.user_id = reply.user_id
    WHERE tweet_id = '${tweetId}';`;

    const repliedUsers = await db.all(getRepliedQuery);
    response.send({ replies: repliedUsers });
  }
);

//API-9
// API-10
app.post("/user/tweets/", authentication, async (request, response) => {
  try {
    // Your existing code for creating a tweet

    // Example code:
    const { userId } = request;
    const dateTime = new Date().toJSON().substring(0, 19).replace("T", " ");
    const createTweetQuery = `
      INSERT INTO tweet(tweet, user_id, date_time) 
      VALUES('${userId}','${userId}','${dateTime}')
    `;

    await db.run(createTweetQuery);
    response.send("Created a Tweet");
  } catch (error) {
    console.error("Error creating tweet:", error.message);
    response.status(500).send("Internal Server Error");
  }
});

// Middleware for invalid JWT token in POST request
const invalidTokenMiddleware = (request, response, next) => {
  response.status(401);
  response.send("Invalid JWT Token");
};

// Apply the invalidTokenMiddleware to the specific route
app.post("/user/tweets/", invalidTokenMiddleware, async (request, response) => {
  // This route will only be reached if there is no valid JWT token
});

//API-10
app.get("/user/tweets/", authentication, async (request, response) => {
  const { userId } = request.body;
  //const userId = parseInt(request.userId);
  const dateTime = new Date().toJSON().substring(0, 19).replace("T", " ");
  const createTweetQuery = `INSERT INTO tweet(tweet, user_id, date_time) 
    VALUES('${userId}','${userId}','${dateTime}')`;

  await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

//API- 11
app.delete("/tweets/:tweetId/", authentication, async (request, response) => {
  const { tweetId } = request.params;
  const { userId } = request;
  const getTweetQuery = `SELECT * FROM tweet 
    WHERE user_id = '${userId}' AND tweet_id = '${tweetId}';`;
  const tweet = await db.get(getTweetQuery);

  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = '${tweetId}';`;
    await db.run(deleteTweetQuery);
    response.send("Tweet Removed");
  }
});

module.exports = app;
