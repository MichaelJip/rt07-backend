import { Response, Request } from "express";
import { UserDTO, UserLoginDTO } from "../utils/zodSchema";
import userModel, { User } from "../models/user.model";
import response from "../utils/response";
import { encrypt } from "../utils/encryption";
import { generateToken } from "../utils/jwt";
import { IReqUser } from "../utils/interface";
import { QueryFilter } from "mongoose";

export default {
  async register(req: Request, res: Response): Promise<void> {
    const { email, username, password, role, address, phone_number } = req.body;
    const image_url = req.file ? `/uploads/${req.file.filename}` : "";

    const parsed = UserDTO.safeParse({
      email,
      username,
      password,
      role,
      address,
      phone_number,
      image_url,
    });

    if (!parsed.success) {
      response.error(res, parsed.error, "validation error");
      return;
    }

    const data = parsed.data;

    try {
      const existingUsername = await userModel.findOne({
        username: data.username,
      });
      if (existingUsername) {
        response.conflict(res, "Username is already taken");
        return;
      }

      const existingEmail = await userModel.findOne({ email: data.email });
      if (existingEmail) {
        response.conflict(res, "Email is already taken");
        return;
      }

      const result = await userModel.create(data);

      response.success(res, result, "success register");
      return;
    } catch (error) {
      console.error("REGISTER ERROR:", error);
      response.error(res, error, "failed to register user");
      return;
    }
  },
  async login(req: Request, res: Response): Promise<void> {
    const { identifier, password } = req.body;

    try {
      await UserLoginDTO.safeParse({ identifier, password });

      const userByIdentifier = await userModel.findOne({
        $or: [{ email: identifier }, { username: identifier }],
      });

      if (!userByIdentifier) {
        return response.unauthorized(res, "user not found");
      }

      const validatePassword: boolean =
        encrypt(password) === userByIdentifier?.password;

      if (!validatePassword) {
        return response.unauthorized(res, "user not found");
      }

      const token = generateToken({
        id: userByIdentifier._id,
        role: userByIdentifier.role,
      });

      return response.success(res, token, "login success");
    } catch (error) {
      response.error(res, error, "failed to login");
      return;
    }
  },
  async me(req: IReqUser, res: Response): Promise<void> {
    try {
      const user = req.user;
      const result = await userModel
        .findById(user?.id)
        .select("-password")
        .lean();
      return response.success(res, result, "success get user profile");
    } catch (error) {
      response.error(res, error, "failed to get user profile");
      return;
    }
  },
  async findAll(req: IReqUser, res: Response): Promise<void> {
    try {
      const { limit = 10, page = 1, search } = req.query;

      let query: QueryFilter<User> = {};

      if (search && typeof search === "string") {
        query.$text = { $search: search };
      }

      const result = await userModel
        .find(query)
        .limit(+limit)
        .skip((+page - 1) * +limit)
        .sort({ created_at: -1 })
        .lean()
        .exec();

      const count = await userModel.countDocuments(query);

      return response.pagination(
        res,
        result,
        {
          total: count,
          totalPages: Math.ceil(count / +limit),
          current: +page,
        },
        "success find all user"
      );
    } catch (error) {
      response.error(res, error, "failed to find all user");
      return;
    }
  },
};
