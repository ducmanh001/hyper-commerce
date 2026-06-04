import { Metadata } from 'next';
import { ReviewModerationClient } from './ReviewModerationClient';

export const metadata: Metadata = { title: 'Kiểm duyệt đánh giá — Admin' };

export const dynamic = 'force-dynamic'; // Always fetch fresh data

export default function ReviewModerationPage() {
  return <ReviewModerationClient />;
}
