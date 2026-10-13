export function rankEngineerProfiles(profiles, { projectType, role, skill } = {}) {
  return profiles
    .filter(profile => profile.available !== false)
    .map(profile => {
      const typeMatch = projectType && profile.projectTypes.includes(projectType) ? 15 : 0
      const roleMatch = role && profile.roles.includes(role) ? 10 : 0
      const skillMatch = skill && profile.skills.some(item => item.toLowerCase() === skill.toLowerCase()) ? 10 : 0
      return { ...profile, matchScore: Math.min(100, Math.round(profile.score + typeMatch + roleMatch + skillMatch)) }
    })
    .sort((a, b) => b.matchScore - a.matchScore || b.score - a.score || a.name.localeCompare(b.name))
}
