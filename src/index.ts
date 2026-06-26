import connect from "./utils/database";
import express from "express";
import cors from "cors";
import bodyParser = require("body-parser");
import router from "./routes/api";
import errorMiddleware from "./middleware/error.middleware";

const app = express();

app.use(cors());
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.status(200).json({
    message: "server is up",
    data: null,
  });
});

app.use("/api", router);
app.use(errorMiddleware.serverRoute());
app.use(errorMiddleware.serverError());

connect().then(() => {
  console.log("Database connected!");
}).catch((err) => {
  console.error("Database connection failed:", err);
});

// Local dev only
if (process.env.NODE_ENV !== "production") {
  const { startMonthlyIuranGeneration } = require("./config/generateIuran");
  startMonthlyIuranGeneration();
  app.listen(3000, () => console.log("Server is up at PORT 3000"));
}

export default app;
