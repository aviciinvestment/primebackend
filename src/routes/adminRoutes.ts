import express from 'express';
import {
  getOverview,
  listUsers,
  listMentors,
  listMentees,
  promoteUser,
  reviewMentorApplication,
  listComplaints,
  resolveComplaint,
} from '../controllers/adminController';
import { requireAdmin } from '../middleware/auth';
import {
  getAdminLaunch,
  setLaunchState,
  setLaunchTimer,
  setWhatsappGroup,
} from '../controllers/launchController';

const router = express.Router();

router.use(requireAdmin);

router.get('/overview', getOverview);
router.get('/users', listUsers);
router.get('/mentors', listMentors);
router.get('/mentees', listMentees);
router.get('/complaints', listComplaints);
router.get('/launch', getAdminLaunch);
router.post('/launch/state', setLaunchState);
router.post('/launch/timer', setLaunchTimer);
router.post('/launch/whatsapp', setWhatsappGroup);
router.post('/users/:uid/promote', promoteUser);
router.post('/mentors/:uid/:action', reviewMentorApplication);
router.post('/complaints/:id/resolve', resolveComplaint);

export default router;