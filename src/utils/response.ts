import { Response } from "express";
import mongoose from "mongoose";
import { ZodError } from "zod";

type Pagination = {
  totalPages: number;
  current: number;
  total: number;
};

export default {
  success(res: Response, data: any, message: string) {
    res.status(200).json({
      meta: {
        status: 200,
        message,
      },
      data,
    });
  },
  error(res: Response, error: unknown, message: string) {
    if (error instanceof ZodError) {
      const formattedErrors: Record<string, string> = {};
      error.issues.forEach((issue) => {
        if (issue.path.length > 0) {
          formattedErrors[issue.path.join(".")] = issue.message;
        }
      });

      return res.status(400).json({
        meta: {
          status: 400,
          message,
        },
        data: formattedErrors,
      });
    }

    if (error instanceof mongoose.Error) {
      return res.status(500).json({
        meta: {
          status: 500,
          message: error.message,
        },
        data: error.name,
      });
    }

    if ((error as any)?.code) {
      const _err = error as any;
      return res.status(500).json({
        meta: {
          status: 500,
          message: _err?.errorResponse?.err || "server error",
        },
        data: _err,
      });
    }

    res.status(500).json({
      meta: {
        status: 500,
        message,
      },
      data: error,
    });
  },
  unauthorized(res: Response, message: string = "unauthorized") {
    res.status(403).json({
      meta: {
        status: 403,
        message,
      },
      data: null,
    });
  },
  notFound(res: Response, message: string = "not found") {
    res.status(404).json({
      meta: {
        status: 404,
        message,
      },
      data: null,
    });
  },
  conflict(res: Response, message: string) {
    res.status(409).json({
      meta: {
        status: 409,
        message,
      },
      data: null,
    });
  },
  pagination(
    res: Response,
    data: any[],
    pagination: Pagination,
    message: string
  ) {
    res.status(200).json({
      meta: {
        status: 200,
        message,
      },
      data,
      pagination,
    });
  },
};
