import { describe, it, expect } from "vitest";
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
} from "@/lib/errors";

describe("canary — error types", () => {
  it("AppError carries code and statusCode", () => {
    const err = new AppError("TEST", "test message", 418);
    expect(err.code).toBe("TEST");
    expect(err.message).toBe("test message");
    expect(err.statusCode).toBe(418);
    expect(err).toBeInstanceOf(Error);
  });

  it("NotFoundError has 404 status", () => {
    const err = new NotFoundError("Issue");
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toContain("Issue");
  });

  it("UnauthorizedError has 401 status", () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
  });

  it("ForbiddenError has 403 status", () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
  });

  it("ValidationError has 422 status", () => {
    const err = new ValidationError("bad input", { field: "email" });
    expect(err.statusCode).toBe(422);
    expect(err.details).toEqual({ field: "email" });
  });
});
