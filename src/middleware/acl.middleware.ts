import { NextFunction, Response } from "express";
import { IReqUser } from "../utils/interface";
import response from "../utils/response";

export default (roles: string[]) => {
  return (req: IReqUser, res: Response, next: NextFunction): void => {
    const role = req.user?.role;

    if (!role || !roles.includes(role)) {
      return response.unauthorized(res, "forbidden");
    }
    next();
  };
};
