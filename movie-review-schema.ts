import { z } from "zod";

const MovieReviewSchema = z.object({
  score: z.number().min(1).max(10),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  keywords: z.array(z.string()),
});

type MovieReview = z.infer<typeof MovieReviewSchema>;

export { MovieReviewSchema, type MovieReview };
