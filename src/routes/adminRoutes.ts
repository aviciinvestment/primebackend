import express from 'express';
import {
  requireAdmin,
  getOverview,
  listUsers,
  listMentors,
  listMentees,
  promoteUser,
  reviewMentorApplication,
  listComplaints,
  resolveComplaint,
} from '../controllers/adminController';

const router = express.Router();

router.use(requireAdmin);

router.get('/overview', getOverview);
router.get('/users', listUsers);
router.get('/mentors', listMentors);
router.get('/mentees', listMentees);
router.get('/complaints', listComplaints);
router.post('/users/:uid/promote', promoteUser);
router.post('/mentors/:uid/:action', reviewMentorApplication);
router.post('/complaints/:id/resolve', resolveComplaint);

export default router;