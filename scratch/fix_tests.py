import sys
import re

content = sys.stdin.read()

# 1. Fix createStudyBlock scoreBreakdown
content = content.replace(
    'priorityWeight: 0,',
    'priorityWeight: 0, coreSyllabusBonus: 0, orderPenalty: 0,'
)

# 2. Fix buildTaskCandidates calls
# We want to find:
# buildTaskCandidates({
#   topics: ...,
#   existingPlannedBlocks: ...,
#   ...
# })
# and add goals: [], coverageReferenceDate: referenceDate (if exists) or options.referenceDate or new Date()

def fix_build_task_candidates(match):
    body = match.group(1)
    if 'goals:' in body:
        return match.group(0)
    
    # Determine reference date
    ref_date = 'new Date()'
    if 'referenceDate: options.referenceDate' in body:
        ref_date = 'options.referenceDate'
    elif 'referenceDate: referenceDate' in body:
        ref_date = 'referenceDate'
    elif 'referenceDate: new Date(' in body:
        m = re.search(r'referenceDate: (new Date\([^)]+\))', body)
        if m:
            ref_date = m.group(1)
    
    # Add missing fields
    new_body = body.rstrip()
    if not new_body.endswith(','):
        new_body += ','
    new_body += f'\n    goals: [],\n    coverageReferenceDate: {ref_date},'
    
    return f'buildTaskCandidates({{{new_body}\n  }})'

content = re.sub(r'buildTaskCandidates\(\{([\s\S]*?)\}\)', fix_build_task_candidates, content)

# 3. Fix getAssignableTaskCandidatesForBlock calls
def fix_get_assignable(match):
    body = match.group(1)
    if 'goals:' in body:
        return match.group(0)
    
    new_body = body.rstrip()
    if not new_body.endswith(','):
        new_body += ','
    new_body += '\n    goals: [],'
    return f'getAssignableTaskCandidatesForBlock({{{new_body}\n  }})'

content = re.sub(r'getAssignableTaskCandidatesForBlock\(\{([\s\S]*?)\}\)', fix_get_assignable, content)

sys.stdout.write(content)
