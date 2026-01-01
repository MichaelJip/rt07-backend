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
      return response.unauthorized(res, "Token expired");
    }

    if (error instanceof jwt.JsonWebTokenError) {
      return response.unauthorized(res, "Invalid token");
    }

    return response.unauthorized(res, "Authentication failed");
  }
};
