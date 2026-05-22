import { describe, it, expect } from "vitest";
import {
  buildPhotoPath,
  isAllowedMime,
  mimeToExt,
} from "../photoSlots";

describe("photoSlots", () => {
  describe("isAllowedMime", () => {
    it("image/jpeg → 허용", () => {
      expect(isAllowedMime("image/jpeg")).toBe(true);
    });

    it("image/png → 허용", () => {
      expect(isAllowedMime("image/png")).toBe(true);
    });

    it("image/webp → 허용", () => {
      expect(isAllowedMime("image/webp")).toBe(true);
    });

    it("image/gif → 거부 (애니메이션·범위 외)", () => {
      expect(isAllowedMime("image/gif")).toBe(false);
    });

    it("빈 문자열 → 거부", () => {
      expect(isAllowedMime("")).toBe(false);
    });
  });

  describe("buildPhotoPath", () => {
    it("review-photos/<reviewId>/<idx>.<ext> 형식 정합성", () => {
      expect(buildPhotoPath("rid_abc", 0, "image/jpeg")).toBe(
        "review-photos/rid_abc/0.jpg",
      );
      expect(buildPhotoPath("rid_abc", 4, "image/png")).toBe(
        "review-photos/rid_abc/4.png",
      );
      expect(buildPhotoPath("rid_abc", 2, "image/webp")).toBe(
        "review-photos/rid_abc/2.webp",
      );
      expect(mimeToExt("image/jpeg")).toBe("jpg");
    });
  });
});
