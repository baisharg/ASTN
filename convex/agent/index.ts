'use node'

import { Agent, stepCountIs } from '@convex-dev/agent'
import { anthropic } from '@ai-sdk/anthropic'
import { components } from '../_generated/api'
import {
  addEducation,
  addWorkExperience,
  editEducation,
  editWorkExperience,
  getCareerActions,
  getMatchDetail,
  getMyMatchesSummary,
  getOpportunityDetail,
  removeEducation,
  removeWorkExperience,
  searchOpportunities,
  setAiSafetyInterests,
  setCareerGoals,
  setCanHelpWith,
  setLanguagePreference,
  setMatchPreferences,
  setSeeking,
  setSkills,
  updateBasicInfo,
} from './tools'

export const profileAgent = new Agent(components.agent, {
  name: 'career-advisor',
  languageModel: anthropic.chat('claude-sonnet-4-6'),
  // Instructions are set dynamically per-turn via streamText system prompt
  instructions: '',
  tools: {
    // Profile building tools
    update_basic_info: updateBasicInfo,
    add_education: addEducation,
    add_work_experience: addWorkExperience,
    remove_education: removeEducation,
    remove_work_experience: removeWorkExperience,
    edit_education: editEducation,
    edit_work_experience: editWorkExperience,
    set_skills: setSkills,
    set_career_goals: setCareerGoals,
    set_ai_safety_interests: setAiSafetyInterests,
    set_seeking: setSeeking,
    set_can_help_with: setCanHelpWith,
    set_match_preferences: setMatchPreferences,
    set_language_preference: setLanguagePreference,
    // Read-only exploration tools
    get_my_matches_summary: getMyMatchesSummary,
    get_match_detail: getMatchDetail,
    search_opportunities: searchOpportunities,
    get_opportunity_detail: getOpportunityDetail,
    get_career_actions: getCareerActions,
  },
  stopWhen: stepCountIs(10),
})
