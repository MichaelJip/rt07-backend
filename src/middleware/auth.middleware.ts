import { NextFunction, Request, Response } from "express";
import response from "../utils/response";
import { getUserData } from "../utils/jwt";
import { IReqUser } from "../utils/interface";
import jwt from "jsonwebtoken";

export default (req: Request, res: Response, next: NextFunction): void => {
  const auth = req.headers.authorization;

  if (!auth) {
    return response.unauthorized(res, "Authorization header missing");
  }

  const [prefix, accessToken] = auth.split(" ");

  if (!(prefix === "Bearer" && accessToken)) {
    return response.unauthorized(res, "Invalid authorization format");
  }

  try {
    const user = getUserData(accessToken);
    (req as IReqUser).user = user;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(500).json({
        meta: {
          status: 500,
          message: "jwt expired",
        },
        data: {
          expiredAt: error.expiredAt,
          message: error.message,
          name: error.name,
        },
      });
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      res.status(500).json({
        meta: {
          status: 500,
          message: "Invalid token",
        },
        data: {
          message: error.message,
          name: error.name,
        },
      });
      return;
    }

    res.status(500).json({
      meta: {
        status: 500,
        message: "Authentication error",
      },
      data: error,
    });
  }
};
