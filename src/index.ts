import connect from "./utils/database";
import express from "express";
import cors from "cors";
import bodyParser = require("body-parser");
import router from "./routes/api";
import errorMiddleware from "./middleware/error.middleware";
import { startMonthlyIuranGeneration } from "./config/generateIuran";

async function init() {
  try {
    const result = await connect();
    console.log("database status: ", result);

    //Express
    const app = express();
    const PORT = 3000;

    //Middleware
    app.use(cors());
    app.use(bodyParser.json());
    app.get("/", (req, res) => {
      res.status(200).json({
        message: "server is up",
        data: null,
      });
    });

    //API
    app.use("/api", router);

    // serve static files
    app.use("/uploads", express.static("uploads"));

    app.use(errorMiddleware.serverRoute());
    app.use(errorMiddleware.serverError());
    startMonthlyIuranGeneration();

    app.listen(PORT, () => {
      console.log(`Server is up at PORT ${PORT}`);
    });
  } catch (error) {
    console.log(error);
  }
}
init();
